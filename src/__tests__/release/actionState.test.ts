import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import type { ActionConfig } from "../../config.js";
import {
  exportChangelogState,
  exportInputState,
  exportPrState,
  exportSetupState,
} from "../../release/actionState.js";
import type { ChangelogPrResult } from "../../release/createChangelogPr.js";
import type { ReleaseSetup } from "../../release/setupRelease.js";

function buildConfig(overrides: Partial<ActionConfig> = {}): ActionConfig {
  return {
    githubToken: "super-secret-token",
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

describe("actionState", () => {
  let githubEnvPath: string;
  let originalGithubEnv: string | undefined;

  beforeEach(() => {
    originalGithubEnv = process.env.GITHUB_ENV;
    githubEnvPath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "github-env-")),
      "env.txt",
    );
    fs.writeFileSync(githubEnvPath, "", "utf8");
    process.env.GITHUB_ENV = githubEnvPath;
  });

  afterEach(() => {
    fs.rmSync(path.dirname(githubEnvPath), { recursive: true, force: true });

    if (originalGithubEnv === undefined) {
      delete process.env.GITHUB_ENV;
    } else {
      process.env.GITHUB_ENV = originalGithubEnv;
    }
  });

  test("exportInputState writes all expected input variables and never GITHUB_TOKEN", () => {
    exportInputState(
      buildConfig({
        dryRun: true,
        ciWorkflows: { mode: "explicit", workflows: ["b.yml", "a.yml"] },
        versionOverride: "9.9.9",
      }),
    );

    const content = fs.readFileSync(githubEnvPath, "utf8");

    expect(content).toContain("DRY_RUN=true\n");
    expect(content).toContain("CHANGELOG_FILE_PATH=CHANGELOG.md\n");
    expect(content).toContain("TAG_TEMPLATE=v<version>\n");
    expect(content).toContain("RELEASE_DRAFT=false\n");
    expect(content).toContain("RELEASE_PRERELEASE=false\n");
    expect(content).toContain("RELEASE_TITLE_PREFIX=\n");
    expect(content).toContain("VERSION_OVERRIDE=9.9.9\n");
    expect(content).toContain("CI_WORKFLOWS=b.yml,a.yml\n");
    expect(content).not.toContain("super-secret-token");
    expect(content).not.toContain("GITHUB_TOKEN");
  });

  test("exportInputState serializes auto and disabled CI workflow modes", () => {
    exportInputState(buildConfig({ ciWorkflows: { mode: "auto" } }));
    exportInputState(buildConfig({ ciWorkflows: { mode: "disabled" } }));

    const content = fs.readFileSync(githubEnvPath, "utf8");
    expect(content).toContain("CI_WORKFLOWS=auto\n");
    expect(content).toContain("CI_WORKFLOWS=none\n");
  });

  test("exportSetupState writes setup variables, including LATEST_TAG only when present", () => {
    exportSetupState(buildSetup());

    let content = fs.readFileSync(githubEnvPath, "utf8");
    expect(content).toContain("VERSION=1.2.3\n");
    expect(content).toContain("TAG=v1.2.3\n");
    expect(content).toContain("RELEASE_TITLE=v1.2.3\n");
    expect(content).toContain("TAG_EXISTS=false\n");
    expect(content).toContain("RELEASE_EXISTS=false\n");
    expect(content).toContain("TARGET_BRANCH=main\n");
    expect(content).not.toContain("LATEST_TAG=");

    fs.writeFileSync(githubEnvPath, "", "utf8");
    exportSetupState(buildSetup({ latestTag: "v1.0.0" }));
    content = fs.readFileSync(githubEnvPath, "utf8");
    expect(content).toContain("LATEST_TAG=v1.0.0\n");
  });

  test("exportChangelogState writes CHANGELOG_UPDATED", () => {
    exportChangelogState(true);
    expect(fs.readFileSync(githubEnvPath, "utf8")).toContain(
      "CHANGELOG_UPDATED=true\n",
    );
  });

  test("exportPrState writes PR_URL and CHANGELOG_PR_HEAD_SHA", () => {
    const result: ChangelogPrResult = {
      prUrl: "https://github.com/owner/repo/pull/5",
      headSha: "abc123",
    };

    exportPrState(result);

    const content = fs.readFileSync(githubEnvPath, "utf8");
    expect(content).toContain("PR_URL=https://github.com/owner/repo/pull/5\n");
    expect(content).toContain("CHANGELOG_PR_HEAD_SHA=abc123\n");
  });
});
