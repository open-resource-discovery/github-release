import * as fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  createTempDir,
  runSourcedShellScript,
  writeExecutable,
} from "./test-utils.js";

describe("update-changelog.sh", () => {
  let tempDir: string;
  let binDir: string;

  beforeEach(() => {
    tempDir = createTempDir("github-release-update-changelog-");
    binDir = path.join(tempDir, "bin");
    fs.mkdirSync(binDir);

    writeExecutable(
      path.join(binDir, "git"),
      `#!/bin/sh
if [ "$1" = "fetch" ]; then
  exit 0
fi

if [ "$1" = "diff" ] && [ "$2" = "--quiet" ]; then
  exit 0
fi

printf '%s\\n' "unexpected git call: $*" >&2
exit 1
`,
    );
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("creates modern release body when version already exists in changelog", () => {
    fs.writeFileSync(
      path.join(tempDir, "CHANGELOG.md"),
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

    fs.writeFileSync(
      path.join(tempDir, "commit_log.txt"),
      "* Existing changelog entry by @alice in [1111111](https://github.com/open-resource-discovery/github-release/commit/sha-one)\n",
      "utf8",
    );

    fs.writeFileSync(
      path.join(tempDir, "contributors.txt"),
      "@alice\n",
      "utf8",
    );

    const githubEnv = path.join(tempDir, "github-env.txt");

    runSourcedShellScript({
      scriptRelativePath: "scripts/update-changelog.sh",
      cwd: tempDir,
      binDir,
      env: {
        CHANGELOG_FILE_PATH: "CHANGELOG.md",
        VERSION: "1.2.3",
        TAG: "v1.2.3",
        TARGET_BRANCH: "main",
        DRY_RUN: "false",
        GITHUB_ENV: githubEnv,
        GITHUB_SERVER_URL: "https://github.com",
        GITHUB_REPOSITORY: "open-resource-discovery/github-release",
      },
    });

    const releaseBody = fs.readFileSync(
      path.join(tempDir, "changelog_content.txt"),
      "utf8",
    );

    expect(releaseBody).toContain("### Added");
    expect(releaseBody).toContain("- Existing changelog entry");
    expect(releaseBody).toContain("------");
    expect(releaseBody).toContain("## What's Changed (commits)");
    expect(releaseBody).toContain(
      "* Existing changelog entry by @alice in [1111111](https://github.com/open-resource-discovery/github-release/commit/sha-one)",
    );
    expect(releaseBody).not.toContain("### Contributors");
    expect(fs.readFileSync(githubEnv, "utf8")).toContain(
      "CHANGELOG_UPDATED=false",
    );
  });

  test("creates modern release body when changelog version is new", () => {
    fs.writeFileSync(
      path.join(tempDir, "CHANGELOG.md"),
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

    fs.writeFileSync(
      path.join(tempDir, "commit_log.txt"),
      "* New changelog entry by @alice in [1111111](https://github.com/open-resource-discovery/github-release/commit/sha-one)\n",
      "utf8",
    );

    fs.writeFileSync(
      path.join(tempDir, "contributors.txt"),
      "@alice\n",
      "utf8",
    );

    const githubEnv = path.join(tempDir, "github-env.txt");

    runSourcedShellScript({
      scriptRelativePath: "scripts/update-changelog.sh",
      cwd: tempDir,
      binDir,
      env: {
        CHANGELOG_FILE_PATH: "CHANGELOG.md",
        VERSION: "1.2.3",
        TAG: "v1.2.3",
        TARGET_BRANCH: "main",
        DRY_RUN: "false",
        GITHUB_ENV: githubEnv,
        GITHUB_SERVER_URL: "https://github.com",
        GITHUB_REPOSITORY: "open-resource-discovery/github-release",
      },
    });

    const releaseBody = fs.readFileSync(
      path.join(tempDir, "changelog_content.txt"),
      "utf8",
    );

    expect(releaseBody).toContain("### Added");
    expect(releaseBody).toContain("- New changelog entry");
    expect(releaseBody).toContain("------");
    expect(releaseBody).toContain("## What's Changed (commits)");
    expect(releaseBody).toContain(
      "* New changelog entry by @alice in [1111111](https://github.com/open-resource-discovery/github-release/commit/sha-one)",
    );
    expect(releaseBody).not.toContain("### Contributors");
    expect(fs.readFileSync(githubEnv, "utf8")).toContain(
      "CHANGELOG_UPDATED=true",
    );
  });
});
