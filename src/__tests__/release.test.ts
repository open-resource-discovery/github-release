import { getOctokit } from "@actions/github";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const mockCreateRelease: jest.Mock = jest.fn();

jest.mock("@actions/github", () => {
  return {
    getOctokit: jest.fn(() => ({
      rest: {
        repos: {
          createRelease: mockCreateRelease,
        },
      },
    })),
    context: {
      repo: { owner: "test-owner", repo: "test-repo" },
    },
  };
});
/* eslint-disable @typescript-eslint/naming-convention */
async function runCreateRelease(): Promise<string> {
  try {
    const { getOctokit, context } = await import("@actions/github");
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      const errorMessage =
        "Error creating release: GITHUB_TOKEN is required but not set.";
      process.stderr.write(errorMessage + "\n");
      throw new Error(errorMessage);
    }

    const octokit = getOctokit(token);
    const { owner, repo } = context.repo;

    const tag_name = process.env.TAG;
    if (!tag_name) {
      const errorMessage =
        "Error creating release: Tag name is required but not set.";
      process.stderr.write(errorMessage + "\n");
      throw new Error(errorMessage);
    }

    const target_commitish = process.env.TARGET_BRANCH || "main";
    const name = process.env.RELEASE_TITLE || `Release ${tag_name}`;
    const body = process.env.RELEASE_BODY || "";
    const draft = process.env.RELEASE_DRAFT === "true";
    const prerelease = process.env.RELEASE_PRERELEASE === "true";

    process.stdout.write(
      `Creating release for tag: ${tag_name} in ${owner}/${repo}\n`,
    );

    let release;
    try {
      release = await octokit.rest.repos.createRelease({
        owner,
        repo,
        tag_name,
        target_commitish,
        name,
        body,
        draft,
        prerelease,
      });
    } catch (error) {
      throw new Error(
        `GitHub API error: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }

    if (!release?.data?.html_url) {
      throw new Error("GitHub API error: Response is missing 'data.html_url'");
    }

    process.stdout.write(`Release created: ${release.data.html_url}\n`);

    return release.data.html_url;
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "An unknown error occurred.";
    process.stderr.write(`Error creating release: ${errorMessage}\n`);
    throw new Error(`Error creating release: ${errorMessage}`);
  }
}

describe("GitHub Release Tests", () => {
  let mockCreateRelease: jest.Mock;
  let stderrSpy: jest.SpiedFunction<typeof process.stderr.write>;

  beforeEach(() => {
    jest.clearAllMocks();

    process.env.GITHUB_TOKEN = "test-token";

    stderrSpy = jest
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    const mockedOctokit = getOctokit("fake-token");
    mockCreateRelease = jest.spyOn(
      mockedOctokit.rest.repos,
      "createRelease",
    ) as jest.Mock;
    mockCreateRelease.mockImplementation(() => ({
      data: { html_url: "https://github.com/test/release" },
    }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("should fail if GITHUB_TOKEN is missing", async () => {
    delete process.env.GITHUB_TOKEN;

    await expect(runCreateRelease()).rejects.toThrow(
      "Error creating release: GITHUB_TOKEN is required but not set.",
    );
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "Error creating release: GITHUB_TOKEN is required but not set.\n",
      ),
    );
  });

  test("should fail if TAG is missing", async () => {
    delete process.env.TAG;

    await expect(runCreateRelease()).rejects.toThrow(
      "Tag name is required but not set.",
    );
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "Error creating release: Tag name is required but not set.",
      ),
    );
  });

  test("should fail if GitHub API request fails", async () => {
    process.env.TAG = "v1.0.0";

    mockCreateRelease.mockImplementation(() =>
      Promise.reject(new Error("GitHub API error")),
    );

    await expect(runCreateRelease()).rejects.toThrow(
      "Error creating release: GitHub API error",
    );
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("Error creating release: GitHub API error"),
    );
  });
});
