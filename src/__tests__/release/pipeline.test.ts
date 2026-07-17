import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import type { ActionConfig } from "../../config.js";
import type { GitPort } from "../../git/git.js";
import { runPipeline } from "../../release/pipeline.js";
import { createFakeGitPort } from "../mocks/git-port.js";
import { createFakeGitHubClient } from "../mocks/github-client.js";

function buildConfig(
  workspaceDir: string,
  overrides: Partial<ActionConfig> = {},
): ActionConfig {
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
    githubWorkspace: workspaceDir,
    ...overrides,
  };
}

function baseGitPort(
  overrides: Parameters<typeof createFakeGitPort>[0] = {},
): GitPort {
  return createFakeGitPort({
    configSafeDirectory: () => undefined,
    configUser: () => undefined,
    configGitHttpAuth: () => undefined,
    fetchBranchesAndTags: () => undefined,
    tagExists: () => false,
    listTagsSortedByVersionDescending: () => [],
    tagList: () => [],
    gitLog: () => "",
    fetchBranches: () => undefined,
    hasDiffAgainstRef: () => false,
    hasUnstagedChanges: () => false,
    cloneWorkspace: () => undefined,
    fetchTargetBranch: () => undefined,
    branchExistsRemote: () => false,
    checkoutBranchFromTarget: () => undefined,
    add: () => undefined,
    commit: () => undefined,
    getHeadSha: () => "head-sha",
    pushBranch: () => undefined,
    ...overrides,
  });
}

describe("runPipeline", () => {
  let workspaceDir: string;

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-"));
    fs.writeFileSync(
      path.join(workspaceDir, "package.json"),
      JSON.stringify({ version: "1.3.0" }),
      "utf8",
    );
  });

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  test("changelog updated: creates PR, throws with PR URL, never creates a release", async () => {
    fs.writeFileSync(
      path.join(workspaceDir, "CHANGELOG.md"),
      ["# Changelog", "", "## [unreleased]", "", "New stuff", ""].join("\n"),
      "utf8",
    );

    const config = buildConfig(workspaceDir);
    let createReleaseCalled = false;

    const git = baseGitPort();
    const client = createFakeGitHubClient({
      createPullRequest: () =>
        Promise.resolve({
          html_url: "https://github.com/owner/repo/pull/5",
          head: { sha: "remote-sha" },
        }),
      createRelease: () => {
        createReleaseCalled = true;
        return Promise.resolve({ html_url: "https://example.com" });
      },
    });

    await expect(runPipeline(config, { git, client })).rejects.toThrow(
      /Please review and merge the changelog PR.*pull\/5/,
    );

    expect(createReleaseCalled).toBe(false);
  });

  test("dry-run with an updated changelog resolves successfully without mutating anything remote", async () => {
    fs.writeFileSync(
      path.join(workspaceDir, "CHANGELOG.md"),
      ["# Changelog", "", "## [unreleased]", "", "New stuff", ""].join("\n"),
      "utf8",
    );

    const config = buildConfig(workspaceDir, { dryRun: true });
    let pushBranchCalled = false;
    let createPullRequestCalled = false;
    let createReleaseCalled = false;

    const git = baseGitPort({
      pushBranch: () => {
        pushBranchCalled = true;
      },
    });
    const client = createFakeGitHubClient({
      createPullRequest: () => {
        createPullRequestCalled = true;
        return Promise.reject(new Error("should not be called"));
      },
      createRelease: () => {
        createReleaseCalled = true;
        return Promise.resolve({ html_url: "https://example.com" });
      },
    });

    await expect(runPipeline(config, { git, client })).resolves.toBeUndefined();

    expect(pushBranchCalled).toBe(false);
    expect(createPullRequestCalled).toBe(false);
    expect(createReleaseCalled).toBe(false);
  });

  test("changelog unchanged and release does not exist: creates the release", async () => {
    fs.writeFileSync(
      path.join(workspaceDir, "CHANGELOG.md"),
      [
        "# Changelog",
        "",
        "## [[1.3.0](https://github.com/owner/repo/releases/tag/v1.3.0)] - 2026-01-01",
        "",
        "Already released",
        "",
        "## [unreleased]",
        "",
      ].join("\n"),
      "utf8",
    );

    const config = buildConfig(workspaceDir);
    let createPullRequestCalled = false;
    let createReleaseUrl: string | undefined;

    const git = baseGitPort();
    const client = createFakeGitHubClient({
      createPullRequest: () => {
        createPullRequestCalled = true;
        return Promise.reject(new Error("should not be called"));
      },
      createRelease: () => {
        createReleaseUrl = "https://github.com/owner/repo/releases/tag/v1.3.0";
        return Promise.resolve({ html_url: createReleaseUrl });
      },
    });

    await runPipeline(config, { git, client });

    expect(createPullRequestCalled).toBe(false);
    expect(createReleaseUrl).toBe(
      "https://github.com/owner/repo/releases/tag/v1.3.0",
    );
  });

  test("release already exists: throws early, never collects commits or creates a PR/release", async () => {
    fs.writeFileSync(
      path.join(workspaceDir, "CHANGELOG.md"),
      ["# Changelog", "", "## [unreleased]", "", ""].join("\n"),
      "utf8",
    );

    const config = buildConfig(workspaceDir);

    const git = createFakeGitPort({
      configSafeDirectory: () => undefined,
      configUser: () => undefined,
      configGitHttpAuth: () => undefined,
      fetchBranchesAndTags: () => undefined,
      tagExists: () => true,
      listTagsSortedByVersionDescending: () => [],
      // tagList/gitLog intentionally NOT configured — if collectCommits ran,
      // the fake's "not configured" guard would throw a different error.
    });
    const client = createFakeGitHubClient({
      getReleaseByTag: () => Promise.resolve({ id: 1 }),
    });

    await expect(runPipeline(config, { git, client })).rejects.toThrow(
      "Release for tag v1.3.0 already exists.",
    );
  });

  test("dry-run resolves silently when a release already exists", async () => {
    fs.writeFileSync(
      path.join(workspaceDir, "CHANGELOG.md"),
      ["# Changelog", "", "## [unreleased]", "", ""].join("\n"),
      "utf8",
    );

    const config = buildConfig(workspaceDir, { dryRun: true });
    let createReleaseCalled = false;

    const git = createFakeGitPort({
      configSafeDirectory: () => undefined,
      configUser: () => undefined,
      configGitHttpAuth: () => undefined,
      fetchBranchesAndTags: () => undefined,
      tagExists: () => true,
      listTagsSortedByVersionDescending: () => [],
    });
    const client = createFakeGitHubClient({
      getReleaseByTag: () => Promise.resolve({ id: 1 }),
      createRelease: () => {
        createReleaseCalled = true;
        return Promise.resolve({ html_url: "https://example.com" });
      },
    });

    await expect(runPipeline(config, { git, client })).resolves.toBeUndefined();
    expect(createReleaseCalled).toBe(false);
  });

  test("dry-run resolves silently when changelog is unchanged and release does not exist yet", async () => {
    fs.writeFileSync(
      path.join(workspaceDir, "CHANGELOG.md"),
      [
        "# Changelog",
        "",
        "## [[1.3.0](https://github.com/owner/repo/releases/tag/v1.3.0)] - 2026-01-01",
        "",
        "Already released",
        "",
        "## [unreleased]",
        "",
      ].join("\n"),
      "utf8",
    );

    const config = buildConfig(workspaceDir, { dryRun: true });
    let createReleaseCalled = false;

    const git = baseGitPort();
    const client = createFakeGitHubClient({
      createRelease: () => {
        createReleaseCalled = true;
        return Promise.resolve({ html_url: "https://example.com" });
      },
    });

    await expect(runPipeline(config, { git, client })).resolves.toBeUndefined();
    expect(createReleaseCalled).toBe(false);
  });
});
