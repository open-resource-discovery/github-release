import * as fs from "node:fs";
import * as path from "node:path";
import type { ActionConfig } from "../config.js";
import type { GitOptions, GitPort } from "../git/git.js";
import {
  GitHubApiError,
  type CheckRunConclusion,
  type CommitStatusState,
  type GitHubClient,
} from "../github/client.js";
import {
  createTempDirectory,
  removeDirectory,
  writeTextFile,
} from "../utils/files.js";
import { info, warning } from "../utils/log.js";
import { parseRepositoryCoordinates } from "../utils/repository.js";
import { retryUntil } from "../utils/retry.js";
import type { ReleaseSetup } from "./setupRelease.js";
import type { ChangelogResult } from "./updateChangelog.js";

export type ChangelogPrResult = {
  prUrl: string;
  headSha: string;
};

const RUN_LOOKUP_MAX_ATTEMPTS = 60;
const RUN_LOOKUP_INTERVAL_MS = 5000;
const RUN_WAIT_MAX_ATTEMPTS = 120;
const RUN_WAIT_INTERVAL_MS = 10000;

const VALID_CHECK_CONCLUSIONS: ReadonlySet<string> = new Set([
  "success",
  "failure",
  "neutral",
  "cancelled",
  "skipped",
  "timed_out",
  "action_required",
]);

function mapJobConclusionToCheckConclusion(
  conclusion: string | null,
): CheckRunConclusion {
  if (conclusion !== null && VALID_CHECK_CONCLUSIONS.has(conclusion)) {
    return conclusion as CheckRunConclusion;
  }

  return "failure";
}

function mapCheckConclusionToCommitStatusState(
  checkConclusion: CheckRunConclusion,
): CommitStatusState {
  return checkConclusion === "success" ||
    checkConclusion === "neutral" ||
    checkConclusion === "skipped"
    ? "success"
    : "failure";
}

function getCurrentReleaseWorkflowPath(
  githubWorkflowRef: string | undefined,
): string | undefined {
  if (githubWorkflowRef === undefined) {
    return undefined;
  }

  const match = /^[^/]*\/[^/]*\/(\.github\/workflows\/[^@]*)@/.exec(
    githubWorkflowRef,
  );

  return match?.[1];
}

function workflowSupportsAutoDispatch(content: string): boolean {
  const nonCommentContent = content
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");

  return /(^|[^_a-zA-Z0-9-])workflow_dispatch([^_a-zA-Z0-9-]|$)/m.test(
    nonCommentContent,
  );
}

function resolveCiWorkflows(
  config: ActionConfig,
  workflowsDir: string,
): string[] {
  if (config.ciWorkflows.mode === "disabled") {
    return [];
  }

  if (config.ciWorkflows.mode === "explicit") {
    return [
      ...new Set(
        config.ciWorkflows.workflows.map((workflow) => path.basename(workflow)),
      ),
    ].sort();
  }

  const currentReleaseWorkflowPath = getCurrentReleaseWorkflowPath(
    config.githubWorkflowRef,
  );
  const discovered: string[] = [];

  if (fs.existsSync(workflowsDir)) {
    for (const entry of fs.readdirSync(workflowsDir)) {
      if (!entry.endsWith(".yml") && !entry.endsWith(".yaml")) {
        continue;
      }

      const relativePath = `.github/workflows/${entry}`;

      if (
        currentReleaseWorkflowPath !== undefined &&
        relativePath === currentReleaseWorkflowPath
      ) {
        info(`Skipping release workflow itself: ${relativePath}`);
        continue;
      }

      const content = fs.readFileSync(path.join(workflowsDir, entry), "utf8");

      if (workflowSupportsAutoDispatch(content)) {
        discovered.push(entry);
      }
    }
  }

  return [...new Set(discovered)].sort();
}

function findDispatchedWorkflowRunId(
  client: GitHubClient,
  owner: string,
  repo: string,
  workflowFile: string,
  branchRef: string,
  headSha: string,
  dispatchStartedAt: string,
): Promise<number> {
  return retryUntil(
    async () => {
      const runs = await client.listWorkflowRuns(owner, repo, workflowFile, {
        branch: branchRef,
        event: "workflow_dispatch",
        perPage: 20,
      });

      const matchBySha = runs.find((run) => run.head_sha === headSha);

      if (matchBySha) {
        return matchBySha.id;
      }

      const matchByBranchAndTime = runs.find(
        (run) =>
          run.head_branch === branchRef && run.created_at >= dispatchStartedAt,
      );

      return matchByBranchAndTime?.id;
    },
    {
      maxAttempts: RUN_LOOKUP_MAX_ATTEMPTS,
      intervalMs: RUN_LOOKUP_INTERVAL_MS,
      description: `dispatched workflow run for '${workflowFile}' on branch '${branchRef}' (SHA '${headSha}')`,
    },
  );
}

async function waitForWorkflowRunCompletion(
  client: GitHubClient,
  owner: string,
  repo: string,
  runId: number,
): Promise<void> {
  await retryUntil(
    async () => {
      const run = await client.getWorkflowRun(owner, repo, runId);
      info(
        `Workflow run ${runId} status: ${run.status} conclusion: ${
          run.conclusion ?? "none"
        }`,
      );
      return run.status === "completed" ? true : undefined;
    },
    {
      maxAttempts: RUN_WAIT_MAX_ATTEMPTS,
      intervalMs: RUN_WAIT_INTERVAL_MS,
      description: `workflow run ${runId} to complete`,
    },
  );
}

async function mirrorWorkflowJobsAsCheckRuns(
  client: GitHubClient,
  owner: string,
  repo: string,
  runId: number,
  headSha: string,
): Promise<void> {
  const jobs = await client.listJobsForWorkflowRun(owner, repo, runId);

  if (jobs.length === 0) {
    throw new Error(
      `Workflow run ${runId} has no jobs. Cannot mirror required checks.`,
    );
  }

  for (const job of jobs) {
    const checkConclusion = mapJobConclusionToCheckConclusion(job.conclusion);

    await client.createCheckRun(owner, repo, {
      name: job.name,
      head_sha: headSha,
      conclusion: checkConclusion,
      details_url: job.html_url ?? undefined,
      summary: `Mirrored result from dispatched workflow run ${runId}.`,
    });

    info(
      `Created check run '${job.name}' with conclusion '${checkConclusion}' for ${headSha}.`,
    );

    const statusState = mapCheckConclusionToCommitStatusState(checkConclusion);

    await client.createCommitStatus(owner, repo, {
      sha: headSha,
      state: statusState,
      context: job.name,
      description: `Mirrored result from dispatched workflow run ${runId}.`,
      targetUrl: job.html_url ?? undefined,
    });

    info(
      `Created commit status '${job.name}' with state '${statusState}' for ${headSha}.`,
    );

    if (
      checkConclusion !== "success" &&
      checkConclusion !== "neutral" &&
      checkConclusion !== "skipped"
    ) {
      throw new Error(
        `Dispatched CI job '${job.name}' finished with conclusion '${
          job.conclusion ?? "failure"
        }'.`,
      );
    }
  }
}

async function dispatchConfiguredCiWorkflows(
  config: ActionConfig,
  client: GitHubClient,
  owner: string,
  repo: string,
  branchName: string,
  headSha: string,
  tempDir: string,
): Promise<void> {
  const workflows = resolveCiWorkflows(
    config,
    path.join(tempDir, ".github", "workflows"),
  );

  if (workflows.length === 0) {
    info("No CI workflows configured or discovered for dispatch.");
    return;
  }

  info(`Dispatching CI workflows for branch: ${branchName}`);
  info(
    `Mirroring dispatched CI jobs as check runs for PR head SHA: ${headSha}`,
  );

  for (const workflowFile of workflows) {
    info(`Dispatching workflow: ${workflowFile}`);
    const dispatchStartedAt = new Date().toISOString();

    await client.createWorkflowDispatch(owner, repo, workflowFile, branchName);
    info(`Workflow dispatched successfully: ${workflowFile}`);

    const runId = await findDispatchedWorkflowRunId(
      client,
      owner,
      repo,
      workflowFile,
      branchName,
      headSha,
      dispatchStartedAt,
    );
    info(`Found dispatched workflow run: ${runId}`);

    await waitForWorkflowRunCompletion(client, owner, repo, runId);
    await mirrorWorkflowJobsAsCheckRuns(client, owner, repo, runId, headSha);
  }
}

export async function createChangelogPr(
  config: ActionConfig,
  setup: ReleaseSetup,
  changelog: ChangelogResult,
  git: GitPort,
  client: GitHubClient,
): Promise<ChangelogPrResult> {
  const branchName = `release-changelog-update/${setup.version}`;
  const tempDir = createTempDirectory("github-release-changelog-pr-");
  const tempOptions: GitOptions = { cwd: tempDir };
  const { owner, repo } = parseRepositoryCoordinates(config.githubRepository);

  try {
    info(`Cloning workspace to temporary directory: ${tempDir}`);
    git.cloneWorkspace(config.githubWorkspace, tempDir);

    git.fetchTargetBranch(setup.targetBranch, tempOptions);

    if (git.branchExistsRemote(branchName, tempOptions)) {
      git.checkoutExistingBranch(branchName, tempOptions);
    } else {
      info(`Creating new branch: ${branchName}`);

      if (config.dryRun) {
        info(`Dry-Run: Skipping 'git checkout -b ${branchName}'.`);
      } else {
        git.checkoutBranchFromTarget(
          branchName,
          setup.targetBranch,
          tempOptions,
        );
      }
    }

    if (config.dryRun) {
      info("Dry-Run: Skipping 'git add' and 'git commit'.");
    } else {
      if (changelog.changelogFileContent !== undefined) {
        writeTextFile(
          path.join(tempDir, config.changelogFilePath),
          changelog.changelogFileContent,
        );
      }

      git.add(config.changelogFilePath, tempOptions);
      git.commit(
        `chore: update changelog for version ${setup.version}`,
        tempOptions,
      );
    }

    const branchHeadSha = git.getHeadSha(tempOptions);
    info(`Local branch HEAD SHA (before push): ${branchHeadSha}`);

    let prUrl: string;
    let headSha: string;

    if (config.dryRun) {
      info(`Dry-Run: Skipping 'git push origin ${branchName}'.`);
      info("Dry-Run: Skipping PR creation.");
      prUrl = `${config.githubServerUrl}/${config.githubRepository}/pull/dry-run-placeholder`;
      headSha = branchHeadSha;
    } else {
      git.pushBranch(branchName, tempOptions);

      const prTitle = `chore: update changelog for version ${setup.version}`;
      const prBody = `This PR updates the changelog for the new version ${setup.version}. Please review and merge it to proceed with the release process.`;

      try {
        const created = await client.createPullRequest({
          owner,
          repo,
          title: prTitle,
          head: branchName,
          base: setup.targetBranch,
          body: prBody,
        });
        prUrl = created.html_url;
        headSha = created.head.sha !== "" ? created.head.sha : branchHeadSha;

        if (created.head.sha === "") {
          warning(
            "PR head SHA not returned by API — falling back to local git SHA",
          );
        }
      } catch (error: unknown) {
        if (error instanceof GitHubApiError && error.status === 422) {
          const existing = await client.findOpenPullRequestByHead(
            owner,
            repo,
            `${owner}:${branchName}`,
            setup.targetBranch,
          );

          if (!existing) {
            throw new Error(
              `PR already exists for branch '${branchName}' but could not be found via the API.`,
              { cause: error },
            );
          }

          info(
            `PR already exists: ${existing.html_url} (head SHA: ${existing.head.sha})`,
          );
          prUrl = existing.html_url;
          headSha =
            existing.head.sha !== "" ? existing.head.sha : branchHeadSha;
        } else {
          throw error;
        }
      }
    }

    info(`Changelog PR head SHA: ${headSha}`);

    if (config.dryRun) {
      info("Dry-Run: Skipping CI workflow dispatch.");
    } else {
      await dispatchConfiguredCiWorkflows(
        config,
        client,
        owner,
        repo,
        branchName,
        headSha,
        tempDir,
      );
    }

    info("A pull request has been created for the changelog update.");
    info(`PR URL: ${prUrl}`);

    return { prUrl, headSha };
  } finally {
    removeDirectory(tempDir);
  }
}
