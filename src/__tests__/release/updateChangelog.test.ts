import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import type { ActionConfig } from "../../config.js";
import type { GitPort } from "../../git/git.js";
import type { CollectedReleaseData } from "../../release/collectCommits.js";
import type { ReleaseSetup } from "../../release/setupRelease.js";
import { updateChangelog } from "../../release/updateChangelog.js";
import { createFakeGitPort } from "../mocks/git-port.js";

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
    ciWorkflows: { mode: "auto" },
    githubServerUrl: "https://github.com",
    githubApiUrl: "https://api.github.com",
    githubRepository: "open-resource-discovery/github-release",
    githubActor: "octocat",
    githubWorkspace: workspaceDir,
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

function buildCollected(
  overrides: Partial<CollectedReleaseData> = {},
): CollectedReleaseData {
  return {
    commitLogLines: [
      "* Existing changelog entry by @alice in [1111111](https://github.com/open-resource-discovery/github-release/commit/sha-one)",
    ],
    ...overrides,
  };
}

function defaultGitPort(
  diffAgainstRefResult = false,
  hasUnstaged = false,
): GitPort {
  return createFakeGitPort({
    fetchBranches: () => undefined,
    hasDiffAgainstRef: () => diffAgainstRefResult,
    hasUnstagedChanges: () => hasUnstaged,
    pullTargetBranch: () => undefined,
    add: () => undefined,
    commit: () => undefined,
  });
}

describe("updateChangelog", () => {
  let workspaceDir: string;

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "update-changelog-"));
  });

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  test("existing version path: extracts description, returns updated=false", async () => {
    fs.writeFileSync(
      path.join(workspaceDir, "CHANGELOG.md"),
      [
        "# Changelog",
        "",
        "## [[1.2.3](https://github.com/open-resource-discovery/github-release/releases/tag/v1.2.3)] - 2026-01-01",
        "### Added",
        "",
        "- Existing changelog entry",
        "",
        "## [unreleased]",
        "",
      ].join("\n"),
      "utf8",
    );

    const config = buildConfig(workspaceDir);
    const setup = buildSetup();
    const collected = buildCollected();
    const git = defaultGitPort();

    const result = await updateChangelog(config, setup, collected, git);

    expect(result.updated).toBe(false);
    expect(result.changelogFileContent).toBeUndefined();
    expect(result.releaseBody).toContain("### Added");
    expect(result.releaseBody).toContain("- Existing changelog entry");
    expect(result.releaseBody).toContain("------");
    expect(result.releaseBody).toMatch(/^## What's Changed$/m);
    expect(result.releaseBody).toContain(
      "* Existing changelog entry by @alice in [1111111](https://github.com/open-resource-discovery/github-release/commit/sha-one)",
    );
  });

  test("new version path: generated changelog does not start with blank lines when there is no header before [unreleased]", async () => {
    fs.writeFileSync(
      path.join(workspaceDir, "CHANGELOG.md"),
      ["## [unreleased]", "", "### Added", "", "- First release", ""].join(
        "\n",
      ),
      "utf8",
    );

    const config = buildConfig(workspaceDir);
    const setup = buildSetup();
    const collected = buildCollected();

    const result = await updateChangelog(config, setup, collected, defaultGitPort());

    expect(result.updated).toBe(true);
    expect(result.changelogFileContent).toBeDefined();
    expect(result.changelogFileContent).not.toMatch(/^\n/);
    expect(result.changelogFileContent).toMatch(/^## \[unreleased\]/);
  });

  test("new version path: returns updated=true with new changelog content", async () => {

    fs.writeFileSync(
      path.join(workspaceDir, "CHANGELOG.md"),
      [
        "# Changelog",
        "",
        "## [unreleased]",
        "",
        "### Added",
        "",
        "- New changelog entry",
        "",
        "## [[1.2.2](https://github.com/open-resource-discovery/github-release/releases/tag/v1.2.2)] - 2025-12-01",
        "",
        "- Old entry",
        "",
      ].join("\n"),
      "utf8",
    );

    const config = buildConfig(workspaceDir);
    const setup = buildSetup();
    const collected = buildCollected({
      commitLogLines: [
        "* New changelog entry by @alice in [1111111](https://github.com/open-resource-discovery/github-release/commit/sha-one)",
      ],
    });
    const git = defaultGitPort();

    const result = await updateChangelog(config, setup, collected, git);

    expect(result.updated).toBe(true);
    expect(result.changelogFileContent).toBeDefined();
    expect(result.changelogFileContent).toContain("## [unreleased]");
    expect(result.changelogFileContent).toContain(
      "## [[1.2.3](https://github.com/open-resource-discovery/github-release/releases/tag/v1.2.3)]",
    );
    expect(result.changelogFileContent).toContain(
      "## [[1.2.2](https://github.com/open-resource-discovery/github-release/releases/tag/v1.2.2)]",
    );
    expect(result.changelogFileContent).toContain("- Old entry");

    expect(result.releaseBody).toContain("### Added");
    expect(result.releaseBody).toContain("- New changelog entry");
    expect(result.releaseBody).toMatch(/^## What's Changed$/m);
    expect(result.releaseBody).not.toContain("## What's Changed (commits)");
  });

  test("falls back to default description when section body is blank", async () => {
    fs.writeFileSync(
      path.join(workspaceDir, "CHANGELOG.md"),
      [
        "# Changelog",
        "",
        "## [unreleased]",
        "",
        "## [[1.0.0](url)] - 2025-01-01",
        "",
      ].join("\n"),
      "utf8",
    );

    const config = buildConfig(workspaceDir);
    const setup = buildSetup({ version: "1.2.3" });
    const collected = buildCollected();
    const git = defaultGitPort();

    const result = await updateChangelog(config, setup, collected, git);

    expect(result.releaseBody).toContain(
      "This release includes the changes below.",
    );
  });

  test("never renders the legacy '(commits)' heading or HTML tables", async () => {
    fs.writeFileSync(
      path.join(workspaceDir, "CHANGELOG.md"),
      ["# Changelog", "", "## [unreleased]", "", "Some description", ""].join(
        "\n",
      ),
      "utf8",
    );

    const config = buildConfig(workspaceDir);
    const setup = buildSetup();
    const collected = buildCollected();
    const git = defaultGitPort();

    const result = await updateChangelog(config, setup, collected, git);

    expect(result.releaseBody).not.toContain("## What's Changed (commits)");
    expect(result.releaseBody).not.toContain("<table");
    expect(result.releaseBody).not.toContain("### Contributors");
  });

  test("includes the Full Changelog link when provided", async () => {
    fs.writeFileSync(
      path.join(workspaceDir, "CHANGELOG.md"),
      ["# Changelog", "", "## [unreleased]", "", "Description", ""].join("\n"),
      "utf8",
    );

    const config = buildConfig(workspaceDir);
    const setup = buildSetup();
    const collected = buildCollected({
      fullChangelogLine:
        "**Full Changelog**: [v1.2.2...v1.2.3](https://github.com/owner/repo/compare/v1.2.2...v1.2.3)",
    });
    const git = defaultGitPort();

    const result = await updateChangelog(config, setup, collected, git);

    expect(result.releaseBody).toContain(
      "**Full Changelog**: [v1.2.2...v1.2.3](https://github.com/owner/repo/compare/v1.2.2...v1.2.3)",
    );
  });

  test("pulls latest target branch when changelog is outdated and not dry-run", async () => {
    fs.writeFileSync(
      path.join(workspaceDir, "CHANGELOG.md"),
      ["# Changelog", "", "## [unreleased]", "", "Description", ""].join("\n"),
      "utf8",
    );

    let pullCalled = false;
    const config = buildConfig(workspaceDir);
    const setup = buildSetup();
    const collected = buildCollected();
    const git = createFakeGitPort({
      fetchBranches: () => undefined,
      hasDiffAgainstRef: () => true,
      hasUnstagedChanges: () => false,
      pullTargetBranch: () => {
        pullCalled = true;
      },
    });

    await updateChangelog(config, setup, collected, git);

    expect(pullCalled).toBe(true);
  });

  test("dry-run skips pulling even when changelog is outdated", async () => {
    fs.writeFileSync(
      path.join(workspaceDir, "CHANGELOG.md"),
      ["# Changelog", "", "## [unreleased]", "", "Description", ""].join("\n"),
      "utf8",
    );

    let pullCalled = false;
    const config = buildConfig(workspaceDir, { dryRun: true });
    const setup = buildSetup();
    const collected = buildCollected();
    const git = createFakeGitPort({
      fetchBranches: () => undefined,
      hasDiffAgainstRef: () => true,
      hasUnstagedChanges: () => false,
      pullTargetBranch: () => {
        pullCalled = true;
      },
    });

    await updateChangelog(config, setup, collected, git);

    expect(pullCalled).toBe(false);
  });

  test("saves changelog before branch switch when unstaged changes exist and not dry-run", async () => {
    fs.writeFileSync(
      path.join(workspaceDir, "CHANGELOG.md"),
      ["# Changelog", "", "## [unreleased]", "", "Description", ""].join("\n"),
      "utf8",
    );

    let addCalled = false;
    let commitCalled = false;
    const config = buildConfig(workspaceDir);
    const setup = buildSetup();
    const collected = buildCollected();
    const git = createFakeGitPort({
      fetchBranches: () => undefined,
      hasDiffAgainstRef: () => true,
      hasUnstagedChanges: () => true,
      pullTargetBranch: () => undefined,
      add: () => {
        addCalled = true;
      },
      commit: () => {
        commitCalled = true;
      },
    });

    await updateChangelog(config, setup, collected, git);

    expect(addCalled).toBe(true);
    expect(commitCalled).toBe(true);
  });

  test("skips saving changelog in dry-run even when unstaged changes exist", async () => {
    fs.writeFileSync(
      path.join(workspaceDir, "CHANGELOG.md"),
      ["# Changelog", "", "## [unreleased]", "", "Description", ""].join("\n"),
      "utf8",
    );

    let addCalled = false;
    const config = buildConfig(workspaceDir, { dryRun: true });
    const setup = buildSetup();
    const collected = buildCollected();
    const git = createFakeGitPort({
      fetchBranches: () => undefined,
      hasDiffAgainstRef: () => true,
      hasUnstagedChanges: () => true,
      pullTargetBranch: () => undefined,
      add: () => {
        addCalled = true;
      },
    });

    await updateChangelog(config, setup, collected, git);

    expect(addCalled).toBe(false);
  });

  test("handles a changelog with no [unreleased] section without throwing", async () => {
    const workspaceDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "changelog-test-"),
    );

    try {
      fs.writeFileSync(
        path.join(workspaceDir, "CHANGELOG.md"),
        "## [1.0.0] - 2025-01-01\n\n### Added\n\n- Initial release.\n",
        "utf8",
      );

      const config = buildConfig(workspaceDir);
      const setup = buildSetup();
      const collected = buildCollected();
      const git = createFakeGitPort({
        fetchBranches: () => undefined,
        hasDiffAgainstRef: () => false,
        hasUnstagedChanges: () => false,
      });

      const result = await updateChangelog(config, setup, collected, git);

      expect(result.updated).toBe(true);
    } finally {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  });
});
