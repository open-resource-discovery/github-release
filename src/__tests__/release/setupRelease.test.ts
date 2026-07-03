import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import type { ActionConfig } from "../../config.js";
import { setupRelease } from "../../release/setupRelease.js";
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
    ciWorkflows: { mode: "auto" },
    githubServerUrl: "https://github.com",
    githubApiUrl: "https://api.github.com",
    githubRepository: "open-resource-discovery/github-release",
    githubActor: "octocat",
    githubWorkspace: "",
    ...overrides,
  };
}

describe("setupRelease", () => {
  let workspaceDir: string;

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "setup-release-"));
  });

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  test("version override wins over package.json", async () => {
    fs.writeFileSync(
      path.join(workspaceDir, "package.json"),
      JSON.stringify({ version: "0.0.1" }),
      "utf8",
    );

    const config = buildConfig({
      githubWorkspace: workspaceDir,
      versionOverride: "9.9.9",
    });

    const git = createFakeGitPort({
      configSafeDirectory: () => undefined,
      configUser: () => undefined,
      configGitHttpAuth: () => undefined,
      fetchBranchesAndTags: () => undefined,
      tagExists: () => false,
      listTagsSortedByVersionDescending: () => [],
    });
    const client = createFakeGitHubClient();

    const setup = await setupRelease(config, git, client);

    expect(setup.version).toBe("9.9.9");
    expect(setup.tag).toBe("v9.9.9");
  });

  test("falls back to package.json version when no override exists", async () => {
    fs.writeFileSync(
      path.join(workspaceDir, "package.json"),
      JSON.stringify({ version: "1.4.0" }),
      "utf8",
    );

    const config = buildConfig({ githubWorkspace: workspaceDir });
    const git = createFakeGitPort({
      configSafeDirectory: () => undefined,
      configUser: () => undefined,
      configGitHttpAuth: () => undefined,
      fetchBranchesAndTags: () => undefined,
      tagExists: () => false,
      listTagsSortedByVersionDescending: () => [],
    });
    const client = createFakeGitHubClient();

    const setup = await setupRelease(config, git, client);

    expect(setup.version).toBe("1.4.0");
  });

  test("throws a clear error when no version can be resolved", async () => {
    const config = buildConfig({ githubWorkspace: workspaceDir });
    const git = createFakeGitPort({
      configSafeDirectory: () => undefined,
      configUser: () => undefined,
      configGitHttpAuth: () => undefined,
    });
    const client = createFakeGitHubClient();

    await expect(setupRelease(config, git, client)).rejects.toThrow(
      'Mandatory "version" parameter has not been specified.',
    );
  });

  test("supports tag templates containing a slash", async () => {
    const config = buildConfig({
      githubWorkspace: workspaceDir,
      versionOverride: "1.2.3",
      tagTemplate: "v/<version>",
    });
    const git = createFakeGitPort({
      configSafeDirectory: () => undefined,
      configUser: () => undefined,
      configGitHttpAuth: () => undefined,
      fetchBranchesAndTags: () => undefined,
      tagExists: () => false,
      listTagsSortedByVersionDescending: () => [],
    });
    const client = createFakeGitHubClient();

    const setup = await setupRelease(config, git, client);

    expect(setup.tag).toBe("v/1.2.3");
  });

  test("detects an existing tag", async () => {
    const config = buildConfig({
      githubWorkspace: workspaceDir,
      versionOverride: "1.2.3",
    });
    const git = createFakeGitPort({
      configSafeDirectory: () => undefined,
      configUser: () => undefined,
      configGitHttpAuth: () => undefined,
      fetchBranchesAndTags: () => undefined,
      tagExists: (tag) => tag === "v1.2.3",
      listTagsSortedByVersionDescending: () => [],
    });
    const client = createFakeGitHubClient({
      getReleaseByTag: () => Promise.resolve(undefined),
    });

    const setup = await setupRelease(config, git, client);

    expect(setup.tagExists).toBe(true);
  });

  test("detects an existing release when the tag and release both exist", async () => {
    const config = buildConfig({
      githubWorkspace: workspaceDir,
      versionOverride: "1.2.3",
    });
    const git = createFakeGitPort({
      configSafeDirectory: () => undefined,
      configUser: () => undefined,
      configGitHttpAuth: () => undefined,
      fetchBranchesAndTags: () => undefined,
      tagExists: (tag) => tag === "v1.2.3",
      listTagsSortedByVersionDescending: () => [],
    });
    const client = createFakeGitHubClient({
      getReleaseByTag: () => Promise.resolve({ id: 42 }),
    });

    const setup = await setupRelease(config, git, client);

    expect(setup.releaseExists).toBe(true);
  });

  test("does not call the release API when the tag does not exist", async () => {
    const config = buildConfig({
      githubWorkspace: workspaceDir,
      versionOverride: "1.2.3",
    });
    const git = createFakeGitPort({
      configSafeDirectory: () => undefined,
      configUser: () => undefined,
      configGitHttpAuth: () => undefined,
      fetchBranchesAndTags: () => undefined,
      tagExists: () => false,
      listTagsSortedByVersionDescending: () => [],
    });
    let callCount = 0;
    const client = createFakeGitHubClient({
      getReleaseByTag: () => {
        callCount += 1;
        return Promise.resolve(undefined);
      },
    });

    const setup = await setupRelease(config, git, client);

    expect(setup.releaseExists).toBe(false);
    expect(callCount).toBe(0);
  });

  test("detects the latest tag matching the tag template", async () => {
    const config = buildConfig({
      githubWorkspace: workspaceDir,
      versionOverride: "1.2.3",
    });
    const git = createFakeGitPort({
      configSafeDirectory: () => undefined,
      configUser: () => undefined,
      configGitHttpAuth: () => undefined,
      fetchBranchesAndTags: () => undefined,
      tagExists: () => false,
      listTagsSortedByVersionDescending: () => ["v1.1.0", "v1.0.0"],
    });
    const client = createFakeGitHubClient();

    const setup = await setupRelease(config, git, client);

    expect(setup.latestTag).toBe("v1.1.0");
  });

  test("target branch prefers githubBaseRef over githubRefName over main", async () => {
    const git = createFakeGitPort({
      configSafeDirectory: () => undefined,
      configUser: () => undefined,
      configGitHttpAuth: () => undefined,
      fetchBranchesAndTags: () => undefined,
      tagExists: () => false,
      listTagsSortedByVersionDescending: () => [],
    });
    const client = createFakeGitHubClient();

    const withBaseRef = await setupRelease(
      buildConfig({
        githubWorkspace: workspaceDir,
        versionOverride: "1.0.0",
        githubBaseRef: "base-branch",
        githubRefName: "ref-branch",
      }),
      git,
      client,
    );
    expect(withBaseRef.targetBranch).toBe("base-branch");

    const withRefNameOnly = await setupRelease(
      buildConfig({
        githubWorkspace: workspaceDir,
        versionOverride: "1.0.0",
        githubRefName: "ref-branch",
      }),
      git,
      client,
    );
    expect(withRefNameOnly.targetBranch).toBe("ref-branch");

    const fallback = await setupRelease(
      buildConfig({ githubWorkspace: workspaceDir, versionOverride: "1.0.0" }),
      git,
      client,
    );
    expect(fallback.targetBranch).toBe("main");
  });

  test("dry-run skips fetchBranchesAndTags", async () => {
    let fetchCalled = false;
    const config = buildConfig({
      githubWorkspace: workspaceDir,
      versionOverride: "1.0.0",
      dryRun: true,
    });
    const git = createFakeGitPort({
      configSafeDirectory: () => undefined,
      configUser: () => undefined,
      configGitHttpAuth: () => undefined,
      fetchBranchesAndTags: () => {
        fetchCalled = true;
      },
      tagExists: () => false,
      listTagsSortedByVersionDescending: () => [],
    });
    const client = createFakeGitHubClient();

    await setupRelease(config, git, client);

    expect(fetchCalled).toBe(false);
  });

  test("respects GitHub Enterprise API URL when checking release existence", async () => {
    const config = buildConfig({
      githubWorkspace: workspaceDir,
      versionOverride: "1.2.3",
      githubServerUrl: "https://ghe.example.com",
      githubApiUrl: "https://ghe.example.com/api/v3",
    });
    const git = createFakeGitPort({
      configSafeDirectory: () => undefined,
      configUser: () => undefined,
      configGitHttpAuth: () => undefined,
      fetchBranchesAndTags: () => undefined,
      tagExists: () => true,
      listTagsSortedByVersionDescending: () => [],
    });
    let receivedApiCall = false;
    const client = createFakeGitHubClient({
      getReleaseByTag: () => {
        receivedApiCall = true;
        return Promise.resolve(undefined);
      },
    });

    await setupRelease(config, git, client);

    expect(receivedApiCall).toBe(true);
  });
});
