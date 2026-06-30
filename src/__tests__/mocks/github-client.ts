import type { GitHubClient } from "../../github/client.js";

function notConfigured(methodName: string): never {
  throw new Error(
    `FakeGitHubClient.${methodName} was called without a configured implementation.`,
  );
}

export function createFakeGitHubClient(
  overrides: Partial<GitHubClient> = {},
): GitHubClient {
  const base: GitHubClient = {
    getReleaseByTag: () => notConfigured("getReleaseByTag"),
    createRelease: () => notConfigured("createRelease"),
    getCommit: () => notConfigured("getCommit"),
    listPullRequestsAssociatedWithCommit: () =>
      notConfigured("listPullRequestsAssociatedWithCommit"),
    createPullRequest: () => notConfigured("createPullRequest"),
    findOpenPullRequestByHead: () => notConfigured("findOpenPullRequestByHead"),
    createWorkflowDispatch: () => notConfigured("createWorkflowDispatch"),
    listWorkflowRuns: () => notConfigured("listWorkflowRuns"),
    getWorkflowRun: () => notConfigured("getWorkflowRun"),
    listJobsForWorkflowRun: () => notConfigured("listJobsForWorkflowRun"),
    createCheckRun: () => notConfigured("createCheckRun"),
    createCommitStatus: () => Promise.resolve(),
  };

  return { ...base, ...overrides };
}
