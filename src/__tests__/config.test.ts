import { describe, expect, test } from "@jest/globals";
import { readActionConfig } from "../config.js";

const BASE_ENV = {
  "INPUT_GITHUB-TOKEN": "ghp_test_token",
  GITHUB_SERVER_URL: "https://github.com",
  GITHUB_API_URL: "https://api.github.com",
  GITHUB_REPOSITORY: "owner/repo",
  GITHUB_ACTOR: "octocat",
  GITHUB_WORKSPACE: "/github/workspace",
};

describe("readActionConfig", () => {
  describe("defaults", () => {
    test("applies all default values when no optional inputs are set", () => {
      const config = readActionConfig(BASE_ENV);
      expect(config.dryRun).toBe(false);
      expect(config.releaseDraft).toBe(false);
      expect(config.releasePrerelease).toBe(false);
      expect(config.releaseTitlePrefix).toBe("");
      expect(config.tagTemplate).toBe("v<version>");
      expect(config.changelogFilePath).toBe("CHANGELOG.md");
      expect(config.versionOverride).toBeUndefined();
    });

    test("reads GitHub token from INPUT_GITHUB-TOKEN", () => {
      const config = readActionConfig(BASE_ENV);
      expect(config.githubToken).toBe("ghp_test_token");
    });

    test("falls back to GITHUB_TOKEN when INPUT_GITHUB-TOKEN is not set", () => {
      const env = { ...BASE_ENV, GITHUB_TOKEN: "fallback_token" };
      delete (env as Record<string, string | undefined>)["INPUT_GITHUB-TOKEN"];
      const config = readActionConfig(env);
      expect(config.githubToken).toBe("fallback_token");
    });

    test("throws when neither token env var is set", () => {
      const env: Record<string, string> = { ...BASE_ENV };
      delete (env as Record<string, string | undefined>)["INPUT_GITHUB-TOKEN"];
      expect(() => readActionConfig(env)).toThrow(
        "GITHUB_TOKEN is required but not set.",
      );
    });

    test("throws when INPUT_GITHUB-TOKEN is empty and GITHUB_TOKEN is not set", () => {
      const env = { ...BASE_ENV, "INPUT_GITHUB-TOKEN": "" };
      expect(() => readActionConfig(env)).toThrow(
        "GITHUB_TOKEN is required but not set.",
      );
    });
  });

  describe("ciWorkflows parsing", () => {
    test("defaults to auto when INPUT_CI-WORKFLOWS is not set", () => {
      const config = readActionConfig(BASE_ENV);
      expect(config.ciWorkflows).toEqual({ mode: "auto" });
    });

    test("returns auto for empty string", () => {
      const config = readActionConfig({
        ...BASE_ENV,
        "INPUT_CI-WORKFLOWS": "",
      });
      expect(config.ciWorkflows).toEqual({ mode: "auto" });
    });

    test("returns auto for explicit 'auto' value", () => {
      const config = readActionConfig({
        ...BASE_ENV,
        "INPUT_CI-WORKFLOWS": "auto",
      });
      expect(config.ciWorkflows).toEqual({ mode: "auto" });
    });

    test("returns disabled for 'none'", () => {
      const config = readActionConfig({
        ...BASE_ENV,
        "INPUT_CI-WORKFLOWS": "none",
      });
      expect(config.ciWorkflows).toEqual({ mode: "disabled" });
    });

    test("returns disabled for 'false'", () => {
      const config = readActionConfig({
        ...BASE_ENV,
        "INPUT_CI-WORKFLOWS": "false",
      });
      expect(config.ciWorkflows).toEqual({ mode: "disabled" });
    });

    test("returns explicit list for comma-separated values", () => {
      const config = readActionConfig({
        ...BASE_ENV,
        "INPUT_CI-WORKFLOWS": "ci.yml,test.yml",
      });
      expect(config.ciWorkflows).toEqual({
        mode: "explicit",
        workflows: ["ci.yml", "test.yml"],
      });
    });

    test("trims whitespace around workflow names", () => {
      const config = readActionConfig({
        ...BASE_ENV,
        "INPUT_CI-WORKFLOWS": " ci.yml , test.yml ",
      });
      expect(config.ciWorkflows).toEqual({
        mode: "explicit",
        workflows: ["ci.yml", "test.yml"],
      });
    });

    test("filters empty entries from comma-separated list", () => {
      const config = readActionConfig({
        ...BASE_ENV,
        "INPUT_CI-WORKFLOWS": "ci.yml,,test.yml",
      });
      expect(config.ciWorkflows).toEqual({
        mode: "explicit",
        workflows: ["ci.yml", "test.yml"],
      });
    });
  });

  describe("boolean parsing", () => {
    test("only exact 'true' enables dryRun", () => {
      expect(
        readActionConfig({ ...BASE_ENV, "INPUT_DRY-RUN": "true" }).dryRun,
      ).toBe(true);
      expect(
        readActionConfig({ ...BASE_ENV, "INPUT_DRY-RUN": "TRUE" }).dryRun,
      ).toBe(false);
      expect(
        readActionConfig({ ...BASE_ENV, "INPUT_DRY-RUN": "1" }).dryRun,
      ).toBe(false);
    });

    test("only exact 'true' enables releaseDraft", () => {
      expect(
        readActionConfig({ ...BASE_ENV, "INPUT_RELEASE-DRAFT": "true" })
          .releaseDraft,
      ).toBe(true);
      expect(
        readActionConfig({ ...BASE_ENV, "INPUT_RELEASE-DRAFT": "TRUE" })
          .releaseDraft,
      ).toBe(false);
    });

    test("only exact 'true' enables releasePrerelease", () => {
      expect(
        readActionConfig({ ...BASE_ENV, "INPUT_RELEASE-PRERELEASE": "true" })
          .releasePrerelease,
      ).toBe(true);
      expect(
        readActionConfig({ ...BASE_ENV, "INPUT_RELEASE-PRERELEASE": "1" })
          .releasePrerelease,
      ).toBe(false);
    });
  });

  describe("GitHub Enterprise support", () => {
    test("preserves custom server and API URLs", () => {
      const config = readActionConfig({
        ...BASE_ENV,
        GITHUB_SERVER_URL: "https://ghe.example.com",
        GITHUB_API_URL: "https://ghe.example.com/api/v3",
      });
      expect(config.githubServerUrl).toBe("https://ghe.example.com");
      expect(config.githubApiUrl).toBe("https://ghe.example.com/api/v3");
    });

    test("throws when GITHUB_SERVER_URL is missing", () => {
      const env: Record<string, string> = { ...BASE_ENV };
      delete (env as Record<string, string | undefined>).GITHUB_SERVER_URL;
      expect(() => readActionConfig(env)).toThrow(
        "GITHUB_SERVER_URL is required but not set.",
      );
    });

    test("throws when GITHUB_API_URL is missing", () => {
      const env: Record<string, string> = { ...BASE_ENV };
      delete (env as Record<string, string | undefined>).GITHUB_API_URL;
      expect(() => readActionConfig(env)).toThrow(
        "GITHUB_API_URL is required but not set.",
      );
    });

    test("preserves GITHUB_REPOSITORY", () => {
      const config = readActionConfig({
        ...BASE_ENV,
        GITHUB_REPOSITORY: "myorg/myrepo",
      });
      expect(config.githubRepository).toBe("myorg/myrepo");
    });
  });

  describe("optional context fields", () => {
    test("versionOverride is set when INPUT_VERSION is provided", () => {
      const config = readActionConfig({
        ...BASE_ENV,
        INPUT_VERSION: "2.3.4",
      });
      expect(config.versionOverride).toBe("2.3.4");
    });

    test("githubRefName and githubBaseRef are undefined when not set", () => {
      const config = readActionConfig(BASE_ENV);
      expect(config.githubRefName).toBeUndefined();
      expect(config.githubBaseRef).toBeUndefined();
    });

    test("githubWorkflowRef is set when present", () => {
      const config = readActionConfig({
        ...BASE_ENV,
        GITHUB_WORKFLOW_REF:
          "owner/repo/.github/workflows/release.yml@refs/heads/main",
      });
      expect(config.githubWorkflowRef).toBe(
        "owner/repo/.github/workflows/release.yml@refs/heads/main",
      );
    });
  });
});
