import { getOctokit } from "@actions/github";

export type ReleaseInfo = { id: number };

export type CreateReleaseInput = {
  owner: string;
  repo: string;
  tag_name: string;
  target_commitish: string;
  name: string;
  body: string;
  draft: boolean;
  prerelease: boolean;
};

export type CreateReleaseResult = { html_url: string };

export type PullRequestSummary = {
  number: number;
  title: string;
  html_url: string;
  user: { login: string } | null;
};

export type CreatePullRequestInput = {
  owner: string;
  repo: string;
  title: string;
  head: string;
  base: string;
  body: string;
};

export type PullRequestRef = {
  html_url: string;
  head: { sha: string };
};

export type WorkflowRun = {
  id: number;
  head_sha: string;
  head_branch: string | null;
  status: string;
  conclusion: string | null;
  created_at: string;
  html_url: string;
};

export type WorkflowJob = {
  name: string;
  conclusion: string | null;
  html_url: string | null;
};

export type CheckRunConclusion =
  | "success"
  | "failure"
  | "neutral"
  | "cancelled"
  | "skipped"
  | "timed_out"
  | "action_required";

export type CreateCheckRunInput = {
  name: string;
  head_sha: string;
  conclusion: CheckRunConclusion;
  details_url?: string;
  summary: string;
};

export class GitHubApiError extends Error {
  public readonly status?: number;

  public constructor(message: string, status?: number) {
    super(message);
    this.name = "GitHubApiError";
    this.status = status;
  }
}

export interface GitHubClient {
  getReleaseByTag(
    owner: string,
    repo: string,
    tag: string,
  ): Promise<ReleaseInfo | undefined>;
  createRelease(input: CreateReleaseInput): Promise<CreateReleaseResult>;
  getCommit(
    owner: string,
    repo: string,
    sha: string,
  ): Promise<{ login?: string }>;
  listPullRequestsAssociatedWithCommit(
    owner: string,
    repo: string,
    sha: string,
  ): Promise<PullRequestSummary[]>;
  createPullRequest(input: CreatePullRequestInput): Promise<PullRequestRef>;
  findOpenPullRequestByHead(
    owner: string,
    repo: string,
    headOwnerColonBranch: string,
    base: string,
  ): Promise<PullRequestRef | undefined>;
  createWorkflowDispatch(
    owner: string,
    repo: string,
    workflowFileName: string,
    ref: string,
  ): Promise<void>;
  listWorkflowRuns(
    owner: string,
    repo: string,
    workflowFileName: string,
    params: { branch: string; event: string; perPage: number },
  ): Promise<WorkflowRun[]>;
  getWorkflowRun(
    owner: string,
    repo: string,
    runId: number,
  ): Promise<{ status: string; conclusion: string | null }>;
  listJobsForWorkflowRun(
    owner: string,
    repo: string,
    runId: number,
  ): Promise<WorkflowJob[]>;
  createCheckRun(
    owner: string,
    repo: string,
    input: CreateCheckRunInput,
  ): Promise<void>;
}

function getErrorStatus(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = error.status;

    if (typeof status === "number") {
      return status;
    }
  }

  return undefined;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown GitHub API error.";
}

export type GitHubClientConfig = {
  githubToken: string;
  githubApiUrl: string;
};

export function createGitHubClient(config: GitHubClientConfig): GitHubClient {
  const octokit = getOctokit(config.githubToken, {
    baseUrl: config.githubApiUrl,
  });

  return {
    async getReleaseByTag(owner, repo, tag): Promise<ReleaseInfo | undefined> {
      try {
        const response = await octokit.rest.repos.getReleaseByTag({
          owner,
          repo,
          tag,
        });
        return { id: response.data.id };
      } catch (error: unknown) {
        if (getErrorStatus(error) === 404) {
          return undefined;
        }
        throw error;
      }
    },

    async createRelease(input): Promise<CreateReleaseResult> {
      const response = await octokit.rest.repos.createRelease(input);
      const htmlUrl: string | undefined = response.data.html_url;

      if (htmlUrl === undefined || htmlUrl === "") {
        throw new GitHubApiError("Release response is missing html_url.");
      }

      return { html_url: htmlUrl };
    },

    async getCommit(owner, repo, sha): Promise<{ login?: string }> {
      const response = await octokit.rest.repos.getCommit({
        owner,
        repo,
        ref: sha,
      });
      return { login: response.data.author?.login ?? undefined };
    },

    async listPullRequestsAssociatedWithCommit(
      owner,
      repo,
      sha,
    ): Promise<PullRequestSummary[]> {
      const response =
        await octokit.rest.repos.listPullRequestsAssociatedWithCommit({
          owner,
          repo,
          commit_sha: sha,
        });

      return response.data.map((pullRequest) => ({
        number: pullRequest.number,
        title: pullRequest.title,
        html_url: pullRequest.html_url,
        user: pullRequest.user ? { login: pullRequest.user.login } : null,
      }));
    },

    async createPullRequest(input): Promise<PullRequestRef> {
      try {
        const response = await octokit.rest.pulls.create(input);
        return {
          html_url: response.data.html_url,
          head: { sha: response.data.head.sha },
        };
      } catch (error: unknown) {
        throw new GitHubApiError(getErrorMessage(error), getErrorStatus(error));
      }
    },

    async findOpenPullRequestByHead(
      owner,
      repo,
      headOwnerColonBranch,
      base,
    ): Promise<PullRequestRef | undefined> {
      const response = await octokit.rest.pulls.list({
        owner,
        repo,
        head: headOwnerColonBranch,
        base,
        state: "open",
        per_page: 1,
      });

      const pullRequest = response.data[0];

      if (!pullRequest) {
        return undefined;
      }

      return {
        html_url: pullRequest.html_url,
        head: { sha: pullRequest.head.sha },
      };
    },

    async createWorkflowDispatch(
      owner,
      repo,
      workflowFileName,
      ref,
    ): Promise<void> {
      await octokit.rest.actions.createWorkflowDispatch({
        owner,
        repo,
        workflow_id: workflowFileName,
        ref,
      });
    },

    async listWorkflowRuns(
      owner,
      repo,
      workflowFileName,
      params,
    ): Promise<WorkflowRun[]> {
      const response = await octokit.rest.actions.listWorkflowRuns({
        owner,
        repo,
        workflow_id: workflowFileName,
        branch: params.branch,
        event: params.event,
        per_page: params.perPage,
      });

      return response.data.workflow_runs.map((run) => ({
        id: run.id,
        head_sha: run.head_sha,
        head_branch: run.head_branch,
        status: run.status ?? "",
        conclusion: run.conclusion,
        created_at: run.created_at,
        html_url: run.html_url,
      }));
    },

    async getWorkflowRun(
      owner,
      repo,
      runId,
    ): Promise<{ status: string; conclusion: string | null }> {
      const response = await octokit.rest.actions.getWorkflowRun({
        owner,
        repo,
        run_id: runId,
      });

      return {
        status: response.data.status ?? "",
        conclusion: response.data.conclusion,
      };
    },

    async listJobsForWorkflowRun(owner, repo, runId): Promise<WorkflowJob[]> {
      const response = await octokit.rest.actions.listJobsForWorkflowRun({
        owner,
        repo,
        run_id: runId,
        per_page: 100,
      });

      return response.data.jobs.map((job) => ({
        name: job.name,
        conclusion: job.conclusion,
        html_url: job.html_url,
      }));
    },

    async createCheckRun(owner, repo, input): Promise<void> {
      await octokit.rest.checks.create({
        owner,
        repo,
        name: input.name,
        head_sha: input.head_sha,
        status: "completed",
        conclusion: input.conclusion,
        details_url: input.details_url,
        output: {
          title: input.name,
          summary: input.summary,
        },
      });
    },
  };
}
