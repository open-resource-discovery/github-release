import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { createRelease } from "../release.js";
import {
  __getCreateReleaseCalls,
  __resetGithubMock,
  __setCreateReleaseHandler,
  __setRepoContext,
} from "./mocks/actions-github.js";

describe("createRelease", () => {
  const originalEnv: NodeJS.ProcessEnv = { ...process.env };

  beforeEach(() => {
    __resetGithubMock();
    jest.restoreAllMocks();
    process.env = { ...originalEnv };

    delete process.env.GITHUB_OUTPUT;
    delete process.env.TARGET_BRANCH;
    delete process.env.RELEASE_TITLE;
    delete process.env.RELEASE_BODY;
    delete process.env.RELEASE_DRAFT;
    delete process.env.RELEASE_PRERELEASE;

    process.env.GITHUB_TOKEN = "test-token";
    process.env.TAG = "v1.2.3";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  test("creates a release with default values and writes GITHUB_OUTPUT", async () => {
    __setRepoContext("open-resource-discovery", "github-release");

    const githubOutput = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "github-release-test-")),
      "github-output.txt",
    );

    process.env.GITHUB_OUTPUT = githubOutput;

    const releaseUrl = await createRelease();

    expect(releaseUrl).toBe(
      "https://github.com/open-resource-discovery/github-release/releases/tag/v1.2.3",
    );

    expect(__getCreateReleaseCalls()).toEqual([
      {
        owner: "open-resource-discovery",
        repo: "github-release",
        tag_name: "v1.2.3",
        target_commitish: "main",
        name: "v1.2.3",
        body: "",
        draft: false,
        prerelease: false,
      },
    ]);

    expect(fs.readFileSync(githubOutput, "utf8")).toBe(
      "release-url=https://github.com/open-resource-discovery/github-release/releases/tag/v1.2.3\n",
    );
  });

  test("uses custom release input values", async () => {
    __setRepoContext("acme", "specification");

    process.env.TARGET_BRANCH = "release/1.x";
    process.env.RELEASE_TITLE = "Release 1.2.3";
    process.env.RELEASE_BODY = "Important changes";
    process.env.RELEASE_DRAFT = "true";
    process.env.RELEASE_PRERELEASE = "true";

    const releaseUrl = await createRelease();

    expect(releaseUrl).toBe(
      "https://github.com/acme/specification/releases/tag/v1.2.3",
    );

    expect(__getCreateReleaseCalls()).toEqual([
      {
        owner: "acme",
        repo: "specification",
        tag_name: "v1.2.3",
        target_commitish: "release/1.x",
        name: "Release 1.2.3",
        body: "Important changes",
        draft: true,
        prerelease: true,
      },
    ]);
  });

  test("fails if GITHUB_TOKEN is missing", async () => {
    delete process.env.GITHUB_TOKEN;

    await expect(createRelease()).rejects.toThrow(
      "GITHUB_TOKEN is required but not set.",
    );

    expect(__getCreateReleaseCalls()).toHaveLength(0);
  });

  test("fails if TAG is missing", async () => {
    delete process.env.TAG;

    await expect(createRelease()).rejects.toThrow(
      "TAG is required but not set.",
    );

    expect(__getCreateReleaseCalls()).toHaveLength(0);
  });

  test("fails if the GitHub API call throws", async () => {
    __setCreateReleaseHandler(() =>
      Promise.reject(new Error("GitHub API error")),
    );

    await expect(createRelease()).rejects.toThrow("GitHub API error");

    expect(__getCreateReleaseCalls()).toHaveLength(1);
  });

  test("fails if the response has no html_url", async () => {
    __setCreateReleaseHandler(() => Promise.resolve({ data: {} }));

    await expect(createRelease()).rejects.toThrow(
      "Release response is missing html_url.",
    );

    expect(__getCreateReleaseCalls()).toHaveLength(1);
  });
});
