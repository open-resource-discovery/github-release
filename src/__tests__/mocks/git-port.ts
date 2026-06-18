import type { GitPort } from "../../git/git.js";

function notConfigured(methodName: string): never {
  throw new Error(
    `FakeGitPort.${methodName} was called without a configured implementation.`,
  );
}

export function createFakeGitPort(overrides: Partial<GitPort> = {}): GitPort {
  const base: GitPort = {
    configSafeDirectory: () => notConfigured("configSafeDirectory"),
    configUser: () => notConfigured("configUser"),
    configGitHttpAuth: () => notConfigured("configGitHttpAuth"),
    fetchBranches: () => notConfigured("fetchBranches"),
    fetchTags: () => notConfigured("fetchTags"),
    fetchBranchesAndTags: () => notConfigured("fetchBranchesAndTags"),
    fetchTargetBranch: () => notConfigured("fetchTargetBranch"),
    tagList: () => notConfigured("tagList"),
    listTagsSortedByVersionDescending: () =>
      notConfigured("listTagsSortedByVersionDescending"),
    revParse: () => notConfigured("revParse"),
    tagExists: () => notConfigured("tagExists"),
    getHeadSha: () => notConfigured("getHeadSha"),
    gitLog: () => notConfigured("gitLog"),
    hasDiffAgainstRef: () => notConfigured("hasDiffAgainstRef"),
    hasUnstagedChanges: () => notConfigured("hasUnstagedChanges"),
    pullTargetBranch: () => notConfigured("pullTargetBranch"),
    checkoutBranchFromTarget: () => notConfigured("checkoutBranchFromTarget"),
    checkoutExistingBranch: () => notConfigured("checkoutExistingBranch"),
    branchExistsRemote: () => notConfigured("branchExistsRemote"),
    add: () => notConfigured("add"),
    commit: () => notConfigured("commit"),
    pushBranch: () => notConfigured("pushBranch"),
    cloneWorkspace: () => notConfigured("cloneWorkspace"),
  };

  return { ...base, ...overrides };
}
