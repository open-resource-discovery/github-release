import { describe, expect, test } from "@jest/globals";
import type { ActionConfig } from "../../config.js";
import { collectCommits } from "../../release/collectCommits.js";
import type { ReleaseSetup } from "../../release/setupRelease.js";
import { createFakeGitPort } from "../mocks/git-port.js";
import { createFakeGitHubClient } from "../mocks/github-client.js";

const FIELD_SEPARATOR = "\x1f";

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
    ciWorkflows: { mode: "auto" },
    githubServerUrl: "https://github.com",
    githubApiUrl: "https://api.github.com",
    githubRepository: "open-resource-discovery/github-release",
    githubActor: "octocat",
    githubWorkspace: "/workspace",
    ...overrides,
  };
}

function buildSetup(overrides: Partial<ReleaseSetup> = {}): ReleaseSetup {
  return {
    version: "1.1.0",
    tag: "v1.1.0",
    releaseTitle: "v1.1.0",
    tagExists: false,
    releaseExists: false,
    targetBranch: "main",
    ...overrides,
  };
}

function commitLine(
  sha: string,
  shortSha: string,
  authorName: string,
  authorEmail: string,
  subject: string,
): string {
  return [sha, shortSha, authorName, authorEmail, subject].join(
    FIELD_SEPARATOR,
  );
}

describe("collectCommits", () => {
  test("falls back to 'No changes since last release' when there are no commits", async () => {
    const config = buildConfig();
    const setup = buildSetup({ tagExists: true });
    const git = createFakeGitPort({
      fetchBranchesAndTags: () => undefined,
      tagList: () => ["v1.0.0"],
      gitLog: () => "",
    });
    const client = createFakeGitHubClient();

    const result = await collectCommits(config, setup, git, client);

    expect(result.commitLogLines).toEqual(["* No changes since last release."]);
  });

  test("computes range against the previous tag and includes a Full Changelog link", async () => {
    const config = buildConfig();
    const setup = buildSetup({ tagExists: true, tag: "v1.1.0" });
    let receivedRange = "";
    const git = createFakeGitPort({
      fetchBranchesAndTags: () => undefined,
      tagList: () => ["v1.0.0"],
      gitLog: (range) => {
        receivedRange = range;
        return "";
      },
    });
    const client = createFakeGitHubClient();

    const result = await collectCommits(config, setup, git, client);

    expect(receivedRange).toBe("v1.0.0..v1.1.0");
    expect(result.fullChangelogLine).toBe(
      "**Full Changelog**: [v1.0.0...v1.1.0](https://github.com/open-resource-discovery/github-release/compare/v1.0.0...v1.1.0)",
    );
  });

  test("supports tags containing a slash in range computation and compare URL", async () => {
    const config = buildConfig();
    const setup = buildSetup({ tagExists: true, tag: "v/1.1.0" });
    let receivedRange = "";
    const git = createFakeGitPort({
      fetchBranchesAndTags: () => undefined,
      tagList: () => ["v/1.0.0"],
      gitLog: (range) => {
        receivedRange = range;
        return "";
      },
    });
    const client = createFakeGitHubClient();

    const result = await collectCommits(config, setup, git, client);

    expect(receivedRange).toBe("v/1.0.0..v/1.1.0");
    expect(result.fullChangelogLine).toContain("compare/v/1.0.0...v/1.1.0");
  });

  test("prefers the PR link over the raw commit link", async () => {
    const config = buildConfig();
    const setup = buildSetup({ tagExists: true });
    const git = createFakeGitPort({
      fetchBranchesAndTags: () => undefined,
      tagList: () => [],
      gitLog: () =>
        commitLine("sha1", "abc1234", "Alice", "alice@example.com", "Fix bug"),
    });
    const client = createFakeGitHubClient({
      getCommit: () => Promise.resolve({ login: "alice" }),
      listPullRequestsAssociatedWithCommit: () =>
        Promise.resolve([
          {
            number: 42,
            title: "Fix the bug",
            html_url: "https://github.com/owner/repo/pull/42",
            user: { login: "alice" },
          },
        ]),
    });

    const result = await collectCommits(config, setup, git, client);

    expect(result.commitLogLines).toEqual([
      "* Fix the bug by @alice in [#42](https://github.com/owner/repo/pull/42)",
    ]);
  });

  test("falls back to the commit link when no PR is associated and none is parseable", async () => {
    const config = buildConfig();
    const setup = buildSetup({ tagExists: true });
    const git = createFakeGitPort({
      fetchBranchesAndTags: () => undefined,
      tagList: () => [],
      gitLog: () =>
        commitLine("sha1", "abc1234", "Bob", "bob@example.com", "Quick fix"),
    });
    const client = createFakeGitHubClient({
      getCommit: () => Promise.resolve({}),
      listPullRequestsAssociatedWithCommit: () => Promise.resolve([]),
    });

    const result = await collectCommits(config, setup, git, client);

    expect(result.commitLogLines).toEqual([
      "* Quick fix by Bob in [abc1234](https://github.com/open-resource-discovery/github-release/commit/sha1)",
    ]);
  });

  test("the same GitHub login can appear on multiple separate lines (no cross-line dedup)", async () => {
    const config = buildConfig();
    const setup = buildSetup({ tagExists: true });
    const git = createFakeGitPort({
      fetchBranchesAndTags: () => undefined,
      tagList: () => [],
      gitLog: () =>
        [
          commitLine(
            "sha-one",
            "1111111",
            "Alice",
            "alice-work@example.com",
            "First change",
          ),
          commitLine(
            "sha-two",
            "2222222",
            "Alice",
            "alice-private@example.com",
            "Second change",
          ),
        ].join("\n"),
    });
    const client = createFakeGitHubClient({
      getCommit: () => Promise.resolve({ login: "alice" }),
      listPullRequestsAssociatedWithCommit: () => Promise.resolve([]),
    });

    const result = await collectCommits(config, setup, git, client);

    expect(result.commitLogLines).toEqual([
      "* First change by @alice in [1111111](https://github.com/open-resource-discovery/github-release/commit/sha-one)",
      "* Second change by @alice in [2222222](https://github.com/open-resource-discovery/github-release/commit/sha-two)",
    ]);
  });

  test("deduplicates PRs by PR number", async () => {
    const config = buildConfig();
    const setup = buildSetup({ tagExists: true });
    const git = createFakeGitPort({
      fetchBranchesAndTags: () => undefined,
      tagList: () => [],
      gitLog: () =>
        [
          commitLine(
            "sha1",
            "abc1111",
            "Alice",
            "alice@example.com",
            "Commit A",
          ),
          commitLine(
            "sha2",
            "abc2222",
            "Alice",
            "alice@example.com",
            "Commit B",
          ),
        ].join("\n"),
    });
    const client = createFakeGitHubClient({
      getCommit: () => Promise.resolve({ login: "alice" }),
      listPullRequestsAssociatedWithCommit: () =>
        Promise.resolve([
          {
            number: 7,
            title: "Shared PR",
            html_url: "https://github.com/owner/repo/pull/7",
            user: { login: "alice" },
          },
        ]),
    });

    const result = await collectCommits(config, setup, git, client);

    expect(result.commitLogLines).toEqual([
      "* Shared PR by @alice in [#7](https://github.com/owner/repo/pull/7)",
    ]);
  });

  test("does not mention bot contributors but still lists their commits by author name", async () => {
    const config = buildConfig();
    const setup = buildSetup({ tagExists: true });
    const git = createFakeGitPort({
      fetchBranchesAndTags: () => undefined,
      tagList: () => [],
      gitLog: () =>
        commitLine(
          "sha-bot",
          "3333333",
          "dependabot[bot]",
          "dependabot[bot]@users.noreply.github.com",
          "Dependency update",
        ),
    });
    const client = createFakeGitHubClient({
      getCommit: () => Promise.resolve({ login: "dependabot" }),
      listPullRequestsAssociatedWithCommit: () => Promise.resolve([]),
    });

    const result = await collectCommits(config, setup, git, client);

    expect(result.commitLogLines).toEqual([
      "* Dependency update by dependabot[bot] in [3333333](https://github.com/open-resource-discovery/github-release/commit/sha-bot)",
    ]);
  });

  test("full changelog link is omitted when there is no previous tag", async () => {
    const config = buildConfig();
    const setup = buildSetup({ tagExists: true });
    const git = createFakeGitPort({
      fetchBranchesAndTags: () => undefined,
      tagList: () => [],
      gitLog: () => "",
    });
    const client = createFakeGitHubClient();

    const result = await collectCommits(config, setup, git, client);

    expect(result.fullChangelogLine).toBeUndefined();
  });

  test("getCommit rejection still produces a commit line, falling back without a login", async () => {
    const config = buildConfig();
    const setup = buildSetup({ tagExists: true });
    const git = createFakeGitPort({
      fetchBranchesAndTags: () => undefined,
      tagList: () => [],
      gitLog: () =>
        commitLine("sha1", "abc1234", "Carol", "carol@example.com", "Fix it"),
    });
    const client = createFakeGitHubClient({
      getCommit: () => Promise.reject(new Error("API unavailable")),
      listPullRequestsAssociatedWithCommit: () => Promise.resolve([]),
    });

    const result = await collectCommits(config, setup, git, client);

    expect(result.commitLogLines).toEqual([
      "* Fix it by Carol in [abc1234](https://github.com/open-resource-discovery/github-release/commit/sha1)",
    ]);
  });

  test("PR lookup rejection falls back to the PR number parsed from the commit subject", async () => {
    const config = buildConfig();
    const setup = buildSetup({ tagExists: true });
    const git = createFakeGitPort({
      fetchBranchesAndTags: () => undefined,
      tagList: () => [],
      gitLog: () =>
        commitLine(
          "sha1",
          "abc1234",
          "Dana",
          "dana@example.com",
          "Add feature (#99)",
        ),
    });
    const client = createFakeGitHubClient({
      getCommit: () => Promise.resolve({ login: "dana" }),
      listPullRequestsAssociatedWithCommit: () =>
        Promise.reject(new Error("API unavailable")),
    });

    const result = await collectCommits(config, setup, git, client);

    expect(result.commitLogLines).toEqual([
      "* Add feature (#99) by @dana in [#99](https://github.com/open-resource-discovery/github-release/pull/99)",
    ]);
  });

  test("both getCommit and PR lookup rejecting still produces a commit-link fallback", async () => {
    const config = buildConfig();
    const setup = buildSetup({ tagExists: true });
    const git = createFakeGitPort({
      fetchBranchesAndTags: () => undefined,
      tagList: () => [],
      gitLog: () =>
        commitLine("sha1", "abc1234", "Eve", "eve@example.com", "Plain fix"),
    });
    const client = createFakeGitHubClient({
      getCommit: () => Promise.reject(new Error("down")),
      listPullRequestsAssociatedWithCommit: () =>
        Promise.reject(new Error("down")),
    });

    const result = await collectCommits(config, setup, git, client);

    expect(result.commitLogLines).toEqual([
      "* Plain fix by Eve in [abc1234](https://github.com/open-resource-discovery/github-release/commit/sha1)",
    ]);
  });

  test("dry-run skips fetchBranchesAndTags", async () => {
    let fetchCalled = false;
    const config = buildConfig({ dryRun: true });
    const setup = buildSetup({ tagExists: true });
    const git = createFakeGitPort({
      fetchBranchesAndTags: () => {
        fetchCalled = true;
      },
      tagList: () => [],
      gitLog: () => "",
    });
    const client = createFakeGitHubClient();

    await collectCommits(config, setup, git, client);

    expect(fetchCalled).toBe(false);
  });
});
