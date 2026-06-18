import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { ActionConfig } from "../../config.js";
import { GitHubApiError } from "../../github/client.js";
import { createChangelogPr } from "../../release/createChangelogPr.js";
import type { ReleaseSetup } from "../../release/setupRelease.js";
import type { ChangelogResult } from "../../release/updateChangelog.js";
import type { GitPort } from "../../git/git.js";
import { createFakeGitPort } from "../mocks/git-port.js";
import { createFakeGitHubClient } from "../mocks/github-client.js";

function buildConfig(overrides: Partial<ActionConfig> = {}): ActionConfig {
  return {
    githubToken: "test-token",
    dryRun: false,
    releaseDraft: false,
    releasePrerelease: false,
    releaseTitlePrefix: "",
    tagTemplate: "v<version>",
    changelogFilePath: "CHANGELOG.md",
    versionOverride: undefined,
    ciWorkflows: { mode: "disabled" },
    githubServerUrl: "https://github.com",
    githubApiUrl: "https://api.github.com",
    githubRepository: "owner/repo",
    githubActor: "octocat",
    githubWorkspace: "/workspace",
    ...overrides,
  };
}

function buildSetup(overrides: Partial<ReleaseSetup> = {}): ReleaseSetup {
  return {
    version: "1.2.3",
    tag: "v1.2.3",
    releaseTitle: "v1.2.3",
    tagExists: false,
    releaseExists: false,
    targetBranch: "main",
    ...overrides,
  };
}

function buildChangelog(
  overrides: Partial<ChangelogResult> = {},
): ChangelogResult {
  return {
    updated: true,
    changelogFileContent: "## [unreleased]\n",
    releaseBody: "Release body",
    ...overrides,
  };
}

function baseGitPort(
  overrides: Parameters<typeof createFakeGitPort>[0] = {},
): GitPort {
  return createFakeGitPort({
    cloneWorkspace: () => undefined,
    fetchTargetBranch: () => undefined,
    branchExistsRemote: () => false,
    checkoutBranchFromTarget: () => undefined,
    checkoutExistingBranch: () => undefined,
    add: () => undefined,
    commit: () => undefined,
    getHeadSha: () => "local-head-sha",
    pushBranch: () => undefined,
    ...overrides,
  });
}

const SUCCESSFUL_RUN = {
  id: 1,
  head_sha: "remote-head-sha",
  head_branch: "release-changelog-update/1.2.3",
  status: "completed",
  conclusion: "success",
  created_at: "2026-01-01T00:00:00Z",
  html_url: "https://github.com/owner/repo/actions/runs/1",
};

describe("createChangelogPr", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test("uses branch name format release-changelog-update/<version>", async () => {
    let receivedBranchName = "";
    const git = baseGitPort({
      checkoutBranchFromTarget: (branchName) => {
        receivedBranchName = branchName;
      },
    });
    const client = createFakeGitHubClient({
      createPullRequest: () =>
        Promise.resolve({
          html_url: "https://github.com/owner/repo/pull/1",
          head: { sha: "remote-head-sha" },
        }),
    });

    await createChangelogPr(
      buildConfig(),
      buildSetup(),
      buildChangelog(),
      git,
      client,
    );

    expect(receivedBranchName).toBe("release-changelog-update/1.2.3");
  });

  test("sends the correct PR creation payload", async () => {
    let captured: unknown;
    const git = baseGitPort();
    const client = createFakeGitHubClient({
      createPullRequest: (input) => {
        captured = input;
        return Promise.resolve({
          html_url: "https://github.com/owner/repo/pull/1",
          head: { sha: "remote-head-sha" },
        });
      },
    });

    await createChangelogPr(
      buildConfig(),
      buildSetup(),
      buildChangelog(),
      git,
      client,
    );

    expect(captured).toEqual({
      owner: "owner",
      repo: "repo",
      title: "chore: update changelog for version 1.2.3",
      head: "release-changelog-update/1.2.3",
      base: "main",
      body: "This PR updates the changelog for the new version 1.2.3. Please review and merge it to proceed with the release process.",
    });
  });

  test("recovers from a 422 already-exists response by looking up the open PR", async () => {
    const git = baseGitPort();
    const client = createFakeGitHubClient({
      createPullRequest: () =>
        Promise.reject(new GitHubApiError("Validation failed", 422)),
      findOpenPullRequestByHead: () =>
        Promise.resolve({
          html_url: "https://github.com/owner/repo/pull/9",
          head: { sha: "existing-head-sha" },
        }),
    });

    const result = await createChangelogPr(
      buildConfig(),
      buildSetup(),
      buildChangelog(),
      git,
      client,
    );

    expect(result.prUrl).toBe("https://github.com/owner/repo/pull/9");
    expect(result.headSha).toBe("existing-head-sha");
  });

  test("throws clearly on a non-422 PR creation failure", async () => {
    const git = baseGitPort();
    const client = createFakeGitHubClient({
      createPullRequest: () =>
        Promise.reject(new GitHubApiError("Internal error", 500)),
    });

    await expect(
      createChangelogPr(
        buildConfig(),
        buildSetup(),
        buildChangelog(),
        git,
        client,
      ),
    ).rejects.toThrow("Internal error");
  });

  test("captures head SHA from the local commit and falls back when API omits it", async () => {
    const git = baseGitPort({ getHeadSha: () => "captured-before-push" });
    const client = createFakeGitHubClient({
      createPullRequest: () =>
        Promise.resolve({
          html_url: "https://github.com/owner/repo/pull/1",
          head: { sha: "" },
        }),
    });

    const result = await createChangelogPr(
      buildConfig(),
      buildSetup(),
      buildChangelog(),
      git,
      client,
    );

    expect(result.headSha).toBe("captured-before-push");
  });

  test("auto discovery finds workflow_dispatch workflows and skips the release workflow itself", async () => {
    const git = baseGitPort({
      cloneWorkspace: (_source, target) => {
        const workflowsDir = path.join(target, ".github", "workflows");
        fs.mkdirSync(workflowsDir, { recursive: true });
        fs.writeFileSync(
          path.join(workflowsDir, "release.yml"),
          "on:\n  workflow_dispatch:\n",
          "utf8",
        );
        fs.writeFileSync(
          path.join(workflowsDir, "ci.yml"),
          "on:\n  workflow_dispatch:\n",
          "utf8",
        );
        fs.writeFileSync(
          path.join(workflowsDir, "push-only.yml"),
          "on:\n  push:\n",
          "utf8",
        );
      },
    });

    const dispatchedWorkflows: string[] = [];
    const client = createFakeGitHubClient({
      createPullRequest: () =>
        Promise.resolve({
          html_url: "https://github.com/owner/repo/pull/1",
          head: { sha: "remote-head-sha" },
        }),
      createWorkflowDispatch: (_owner, _repo, workflowFileName) => {
        dispatchedWorkflows.push(workflowFileName);
        return Promise.resolve();
      },
      listWorkflowRuns: () => Promise.resolve([SUCCESSFUL_RUN]),
      getWorkflowRun: () =>
        Promise.resolve({ status: "completed", conclusion: "success" }),
      listJobsForWorkflowRun: () =>
        Promise.resolve([
          { name: "Dummy CI Check", conclusion: "success", html_url: null },
        ]),
      createCheckRun: () => Promise.resolve(),
    });

    const config = buildConfig({
      ciWorkflows: { mode: "auto" },
      githubWorkflowRef:
        "owner/repo/.github/workflows/release.yml@refs/heads/main",
    });

    await createChangelogPr(
      config,
      buildSetup(),
      buildChangelog(),
      git,
      client,
    );

    expect(dispatchedWorkflows).toEqual(["ci.yml"]);
  });

  test("explicit workflow list bypasses discovery", async () => {
    const git = baseGitPort();
    const dispatchedWorkflows: string[] = [];
    const client = createFakeGitHubClient({
      createPullRequest: () =>
        Promise.resolve({
          html_url: "https://github.com/owner/repo/pull/1",
          head: { sha: "remote-head-sha" },
        }),
      createWorkflowDispatch: (_owner, _repo, workflowFileName) => {
        dispatchedWorkflows.push(workflowFileName);
        return Promise.resolve();
      },
      listWorkflowRuns: () => Promise.resolve([SUCCESSFUL_RUN]),
      getWorkflowRun: () =>
        Promise.resolve({ status: "completed", conclusion: "success" }),
      listJobsForWorkflowRun: () =>
        Promise.resolve([
          { name: "Explicit Check", conclusion: "success", html_url: null },
        ]),
      createCheckRun: () => Promise.resolve(),
    });

    const config = buildConfig({
      ciWorkflows: { mode: "explicit", workflows: ["explicit.yml"] },
    });

    await createChangelogPr(
      config,
      buildSetup(),
      buildChangelog(),
      git,
      client,
    );

    expect(dispatchedWorkflows).toEqual(["explicit.yml"]);
  });

  test("disabled mode dispatches nothing", async () => {
    const git = baseGitPort();
    let dispatchCalled = false;
    const client = createFakeGitHubClient({
      createPullRequest: () =>
        Promise.resolve({
          html_url: "https://github.com/owner/repo/pull/1",
          head: { sha: "remote-head-sha" },
        }),
      createWorkflowDispatch: () => {
        dispatchCalled = true;
        return Promise.resolve();
      },
    });

    await createChangelogPr(
      buildConfig({ ciWorkflows: { mode: "disabled" } }),
      buildSetup(),
      buildChangelog(),
      git,
      client,
    );

    expect(dispatchCalled).toBe(false);
  });

  test("dispatch call includes the branch ref", async () => {
    const git = baseGitPort();
    let receivedRef = "";
    const client = createFakeGitHubClient({
      createPullRequest: () =>
        Promise.resolve({
          html_url: "https://github.com/owner/repo/pull/1",
          head: { sha: "remote-head-sha" },
        }),
      createWorkflowDispatch: (_owner, _repo, _workflowFileName, ref) => {
        receivedRef = ref;
        return Promise.resolve();
      },
      listWorkflowRuns: () => Promise.resolve([SUCCESSFUL_RUN]),
      getWorkflowRun: () =>
        Promise.resolve({ status: "completed", conclusion: "success" }),
      listJobsForWorkflowRun: () =>
        Promise.resolve([
          { name: "Check", conclusion: "success", html_url: null },
        ]),
      createCheckRun: () => Promise.resolve(),
    });

    await createChangelogPr(
      buildConfig({ ciWorkflows: { mode: "explicit", workflows: ["x.yml"] } }),
      buildSetup(),
      buildChangelog(),
      git,
      client,
    );

    expect(receivedRef).toBe("release-changelog-update/1.2.3");
  });

  test("run lookup falls back to branch+created_at when head_sha does not match", async () => {
    const git = baseGitPort();
    const createCheckRunCalls: { name: string; conclusion: string }[] = [];
    const client = createFakeGitHubClient({
      createPullRequest: () =>
        Promise.resolve({
          html_url: "https://github.com/owner/repo/pull/1",
          head: { sha: "remote-head-sha" },
        }),
      createWorkflowDispatch: () => Promise.resolve(),
      listWorkflowRuns: () =>
        Promise.resolve([
          {
            id: 2,
            head_sha: "some-other-sha",
            head_branch: "release-changelog-update/1.2.3",
            status: "completed",
            conclusion: "success",
            created_at: "2099-01-01T00:00:00Z",
            html_url: "https://github.com/owner/repo/actions/runs/2",
          },
        ]),
      getWorkflowRun: () =>
        Promise.resolve({ status: "completed", conclusion: "success" }),
      listJobsForWorkflowRun: () =>
        Promise.resolve([
          { name: "Check", conclusion: "success", html_url: null },
        ]),
      createCheckRun: (_owner, _repo, input) => {
        createCheckRunCalls.push({
          name: input.name,
          conclusion: input.conclusion,
        });
        return Promise.resolve();
      },
    });

    await createChangelogPr(
      buildConfig({ ciWorkflows: { mode: "explicit", workflows: ["x.yml"] } }),
      buildSetup(),
      buildChangelog(),
      git,
      client,
    );

    expect(createCheckRunCalls).toEqual([
      { name: "Check", conclusion: "success" },
    ]);
  });

  test("check run is created with the exact job name and the changelog PR head SHA", async () => {
    const git = baseGitPort();
    const createCheckRunCalls: { name: string; head_sha: string }[] = [];
    const client = createFakeGitHubClient({
      createPullRequest: () =>
        Promise.resolve({
          html_url: "https://github.com/owner/repo/pull/1",
          head: { sha: "remote-head-sha" },
        }),
      createWorkflowDispatch: () => Promise.resolve(),
      listWorkflowRuns: () => Promise.resolve([SUCCESSFUL_RUN]),
      getWorkflowRun: () =>
        Promise.resolve({ status: "completed", conclusion: "success" }),
      listJobsForWorkflowRun: () =>
        Promise.resolve([
          { name: "Dummy CI Check", conclusion: "success", html_url: null },
        ]),
      createCheckRun: (_owner, _repo, input) => {
        createCheckRunCalls.push({
          name: input.name,
          head_sha: input.head_sha,
        });
        return Promise.resolve();
      },
    });

    await createChangelogPr(
      buildConfig({ ciWorkflows: { mode: "explicit", workflows: ["x.yml"] } }),
      buildSetup(),
      buildChangelog(),
      git,
      client,
    );

    expect(createCheckRunCalls).toEqual([
      { name: "Dummy CI Check", head_sha: "remote-head-sha" },
    ]);
  });

  test("a failing job still creates a check run and fails the overall call", async () => {
    const git = baseGitPort();
    const createCheckRunCalls: { name: string; conclusion: string }[] = [];
    const client = createFakeGitHubClient({
      createPullRequest: () =>
        Promise.resolve({
          html_url: "https://github.com/owner/repo/pull/1",
          head: { sha: "remote-head-sha" },
        }),
      createWorkflowDispatch: () => Promise.resolve(),
      listWorkflowRuns: () =>
        Promise.resolve([{ ...SUCCESSFUL_RUN, conclusion: "failure" }]),
      getWorkflowRun: () =>
        Promise.resolve({ status: "completed", conclusion: "failure" }),
      listJobsForWorkflowRun: () =>
        Promise.resolve([
          { name: "Failing Check", conclusion: "failure", html_url: null },
        ]),
      createCheckRun: (_owner, _repo, input) => {
        createCheckRunCalls.push({
          name: input.name,
          conclusion: input.conclusion,
        });
        return Promise.resolve();
      },
    });

    await expect(
      createChangelogPr(
        buildConfig({
          ciWorkflows: { mode: "explicit", workflows: ["x.yml"] },
        }),
        buildSetup(),
        buildChangelog(),
        git,
        client,
      ),
    ).rejects.toThrow(
      "Dispatched CI job 'Failing Check' finished with conclusion 'failure'.",
    );

    expect(createCheckRunCalls).toEqual([
      { name: "Failing Check", conclusion: "failure" },
    ]);
  });

  test("no workflow run found after exhausting retries throws clearly", async () => {
    jest.useFakeTimers();

    const git = baseGitPort();
    const client = createFakeGitHubClient({
      createPullRequest: () =>
        Promise.resolve({
          html_url: "https://github.com/owner/repo/pull/1",
          head: { sha: "remote-head-sha" },
        }),
      createWorkflowDispatch: () => Promise.resolve(),
      listWorkflowRuns: () => Promise.resolve([]),
    });

    const resultPromise = createChangelogPr(
      buildConfig({ ciWorkflows: { mode: "explicit", workflows: ["x.yml"] } }),
      buildSetup(),
      buildChangelog(),
      git,
      client,
    );

    const expectation = expect(resultPromise).rejects.toThrow(
      /Timed out while waiting for dispatched workflow run/,
    );

    await jest.advanceTimersByTimeAsync(60 * 5000 + 1000);
    await expectation;
  }, 20000);

  test("dry-run PR URL uses the configured GitHub Enterprise server URL, not github.com", async () => {
    const git = baseGitPort();
    const client = createFakeGitHubClient();

    const result = await createChangelogPr(
      buildConfig({
        dryRun: true,
        githubServerUrl: "https://github.example-corp.com",
      }),
      buildSetup(),
      buildChangelog(),
      git,
      client,
    );

    expect(result.prUrl).toBe(
      "https://github.example-corp.com/owner/repo/pull/dry-run-placeholder",
    );
  });
});
