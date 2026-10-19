import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import type { ActionConfig } from "../../config.js";
import { createReleaseForTag } from "../../release/createRelease.js";
import type { ReleaseSetup } from "../../release/setupRelease.js";
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
    version: "1.2.3",
    tag: "v1.2.3",
    releaseTitle: "v1.2.3",
    tagExists: false,
    releaseExists: false,
    targetBranch: "main",
    ...overrides,
  };
}

describe("createReleaseForTag", () => {
  const originalGithubOutput = process.env.GITHUB_OUTPUT;
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "create-release-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });

    if (originalGithubOutput === undefined) {
      delete process.env.GITHUB_OUTPUT;
    } else {
      process.env.GITHUB_OUTPUT = originalGithubOutput;
    }
  });

  test("requires a non-empty tag", async () => {
    const client = createFakeGitHubClient();

    await expect(
      createReleaseForTag(
        buildConfig(),
        buildSetup({ tag: "" }),
        "body",
        client,
      ),
    ).rejects.toThrow("TAG is required but not set.");
  });

  test("sends the correct create-release payload", async () => {
    let captured: unknown;
    const client = createFakeGitHubClient({
      createRelease: (input) => {
        captured = input;
        return Promise.resolve({
          html_url:
            "https://github.com/open-resource-discovery/github-release/releases/tag/v1.2.3",
        });
      },
    });

    await createReleaseForTag(
      buildConfig(),
      buildSetup(),
      "Release body",
      client,
    );

    expect(captured).toEqual({
      owner: "open-resource-discovery",
      repo: "github-release",
      tag_name: "v1.2.3",
      target_commitish: "main",
      name: "v1.2.3",
      body: "Release body",
      draft: false,
      prerelease: false,
    });
  });

  test("respects draft and prerelease flags", async () => {
    let captured: { draft: boolean; prerelease: boolean } | undefined;
    const client = createFakeGitHubClient({
      createRelease: (input) => {
        captured = { draft: input.draft, prerelease: input.prerelease };
        return Promise.resolve({ html_url: "https://example.com/release" });
      },
    });

    await createReleaseForTag(
      buildConfig({ releaseDraft: true, releasePrerelease: true }),
      buildSetup(),
      "body",
      client,
    );

    expect(captured).toEqual({ draft: true, prerelease: true });
  });

  test("writes release-url to GITHUB_OUTPUT", async () => {
    const githubOutput = path.join(tempDir, "github-output.txt");
    fs.writeFileSync(githubOutput, "", "utf8");
    process.env.GITHUB_OUTPUT = githubOutput;

    const client = createFakeGitHubClient({
      createRelease: () =>
        Promise.resolve({ html_url: "https://example.com/releases/v1.2.3" }),
    });

    const url = await createReleaseForTag(
      buildConfig(),
      buildSetup(),
      "body",
      client,
    );

    expect(url).toBe("https://example.com/releases/v1.2.3");
    expect(fs.readFileSync(githubOutput, "utf8")).toBe(
      "release-url=https://example.com/releases/v1.2.3\n",
    );
  });

  test("uses setup.targetBranch as target_commitish when config.targetCommitish is absent", async () => {
    let captured: { target_commitish: string } | undefined;
    const client = createFakeGitHubClient({
      createRelease: (input) => {
        captured = { target_commitish: input.target_commitish };
        return Promise.resolve({ html_url: "https://example.com/release" });
      },
    });

    await createReleaseForTag(
      buildConfig(),
      buildSetup({ targetBranch: "main" }),
      "body",
      client,
    );

    expect(captured?.target_commitish).toBe("main");
  });

  test("uses config.targetCommitish (SHA) over setup.targetBranch when provided", async () => {
    let captured: { target_commitish: string } | undefined;
    const client = createFakeGitHubClient({
      createRelease: (input) => {
        captured = { target_commitish: input.target_commitish };
        return Promise.resolve({ html_url: "https://example.com/release" });
      },
    });

    await createReleaseForTag(
      buildConfig({ targetCommitish: "abc1234def5678" }),
      buildSetup({ targetBranch: "main" }),
      "body",
      client,
    );

    expect(captured?.target_commitish).toBe("abc1234def5678");
  });

  test("uses config.targetCommitish (branch ref) over setup.targetBranch when provided", async () => {
    let captured: { target_commitish: string } | undefined;
    const client = createFakeGitHubClient({
      createRelease: (input) => {
        captured = { target_commitish: input.target_commitish };
        return Promise.resolve({ html_url: "https://example.com/release" });
      },
    });

    await createReleaseForTag(
      buildConfig({ targetCommitish: "release-only/v1.2.3" }),
      buildSetup({ targetBranch: "main" }),
      "body",
      client,
    );

    expect(captured?.target_commitish).toBe("release-only/v1.2.3");
  });

  test("falls back to setup.targetBranch when config.targetCommitish is undefined", async () => {
    let captured: { target_commitish: string } | undefined;
    const client = createFakeGitHubClient({
      createRelease: (input) => {
        captured = { target_commitish: input.target_commitish };
        return Promise.resolve({ html_url: "https://example.com/release" });
      },
    });

    await createReleaseForTag(
      buildConfig({ targetCommitish: undefined }),
      buildSetup({ targetBranch: "release-branch" }),
      "body",
      client,
    );

    expect(captured?.target_commitish).toBe("release-branch");
  });

  test("bubbles up API failures clearly", async () => {
    const client = createFakeGitHubClient({
      createRelease: () => Promise.reject(new Error("GitHub API error")),
    });

    await expect(
      createReleaseForTag(buildConfig(), buildSetup(), "body", client),
    ).rejects.toThrow("GitHub API error");
  });
});
