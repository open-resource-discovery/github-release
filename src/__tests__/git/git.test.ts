import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  add,
  branchExistsRemote,
  checkoutBranchFromTarget,
  checkoutExistingBranch,
  cloneWorkspace,
  commit,
  configGitHttpAuth,
  configSafeDirectory,
  configUser,
  execGit,
  fetchBranches,
  fetchBranchesAndTags,
  fetchTags,
  fetchTargetBranch,
  getHeadSha,
  gitLog,
  hasDiffAgainstRef,
  hasUnstagedChanges,
  listTagsSortedByVersionDescending,
  pullTargetBranch,
  pushBranch,
  requireGit,
  revParse,
  tagExists,
  tagList,
} from "../../git/git.js";

describe("git", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "git-test-"));
    requireGit(["init", "-b", "main"], { cwd: repoDir });
    requireGit(["config", "user.name", "test-actor"], { cwd: repoDir });
    requireGit(
      ["config", "user.email", "test-actor@users.noreply.github.com"],
      { cwd: repoDir },
    );
    fs.writeFileSync(path.join(repoDir, "file.txt"), "hello\n", "utf8");
    add("file.txt", { cwd: repoDir });
    commit("initial commit", { cwd: repoDir });
  });

  afterEach(() => {
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  describe("requireGit", () => {
    test("throws an error including command, exit code, and stderr on failure", () => {
      expect(() =>
        requireGit(["rev-parse", "--verify", "refs/heads/does-not-exist"], {
          cwd: repoDir,
        }),
      ).toThrow(/exit code/);
    });

    test("returns trimmed stdout on success", () => {
      const output = requireGit(["rev-parse", "--abbrev-ref", "HEAD"], {
        cwd: repoDir,
      });
      expect(output).toBe("main");
    });
  });

  describe("execGit", () => {
    test("never throws, returns exitCode for failures", () => {
      const result = execGit(["rev-parse", "--verify", "refs/heads/missing"], {
        cwd: repoDir,
      });
      expect(result.exitCode).not.toBe(0);
    });
  });

  describe("tagExists", () => {
    test("returns false for a tag that does not exist", () => {
      expect(tagExists("v9.9.9", { cwd: repoDir })).toBe(false);
    });

    test("returns true for a tag that exists", () => {
      requireGit(["tag", "v1.0.0"], { cwd: repoDir });
      expect(tagExists("v1.0.0", { cwd: repoDir })).toBe(true);
    });

    test("supports tag names containing slashes", () => {
      requireGit(["tag", "v/1.2.3"], { cwd: repoDir });
      expect(tagExists("v/1.2.3", { cwd: repoDir })).toBe(true);
      expect(tagList({ cwd: repoDir })).toContain("v/1.2.3");
    });
  });

  describe("revParse", () => {
    test("returns undefined for a missing ref instead of throwing", () => {
      expect(revParse("refs/heads/missing", { cwd: repoDir })).toBeUndefined();
    });

    test("returns the resolved sha for an existing ref", () => {
      const sha = revParse("HEAD", { cwd: repoDir });
      expect(sha).toMatch(/^[0-9a-f]{40}$/);
    });
  });

  describe("commit", () => {
    test("does not throw when there is nothing to commit", () => {
      expect(() =>
        commit("empty commit attempt", { cwd: repoDir }),
      ).not.toThrow();
    });

    test("throws when git commit fails for a non-'nothing to commit' reason", () => {
      const nonRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), "non-git-"));
      try {
        expect(() => commit("test", { cwd: nonRepoDir })).toThrow(
          /git commit failed/,
        );
      } finally {
        fs.rmSync(nonRepoDir, { recursive: true, force: true });
      }
    });
  });

  describe("hasUnstagedChanges", () => {
    test("returns false when file is unchanged", () => {
      expect(hasUnstagedChanges("file.txt", { cwd: repoDir })).toBe(false);
    });

    test("returns true when file has unstaged modifications", () => {
      fs.writeFileSync(path.join(repoDir, "file.txt"), "changed\n", "utf8");
      expect(hasUnstagedChanges("file.txt", { cwd: repoDir })).toBe(true);
    });
  });

  describe("branchExistsRemote", () => {
    test("returns false when there is no remote configured", () => {
      expect(branchExistsRemote("some-branch", { cwd: repoDir })).toBe(false);
    });
  });

  describe("checkoutExistingBranch", () => {
    test("checks out a branch that exists on the remote but has no local ref", () => {
      requireGit(["checkout", "-b", "feature-branch"], { cwd: repoDir });
      fs.writeFileSync(
        path.join(repoDir, "file.txt"),
        "from feature\n",
        "utf8",
      );
      add("file.txt", { cwd: repoDir });
      commit("feature commit", { cwd: repoDir });
      requireGit(["checkout", "main"], { cwd: repoDir });

      const localDir = fs.mkdtempSync(path.join(os.tmpdir(), "git-local-"));
      fs.rmSync(localDir, { recursive: true, force: true });
      requireGit(["clone", repoDir, localDir]);

      expect(
        requireGit(["branch", "--list", "feature-branch"], { cwd: localDir }),
      ).toBe("");

      checkoutExistingBranch("feature-branch", { cwd: localDir });

      expect(
        requireGit(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: localDir }),
      ).toBe("feature-branch");
      expect(
        fs.readFileSync(path.join(localDir, "file.txt"), "utf8").trim(),
      ).toBe("from feature");

      fs.rmSync(localDir, { recursive: true, force: true });
    });

    test("resets an existing local branch to match the remote", () => {
      requireGit(["checkout", "-b", "feature-branch"], { cwd: repoDir });
      requireGit(["checkout", "main"], { cwd: repoDir });

      const localDir = fs.mkdtempSync(path.join(os.tmpdir(), "git-local-"));
      fs.rmSync(localDir, { recursive: true, force: true });
      requireGit(["clone", repoDir, localDir]);
      requireGit(["config", "user.name", "test-actor"], { cwd: localDir });
      requireGit(
        ["config", "user.email", "test-actor@users.noreply.github.com"],
        { cwd: localDir },
      );
      requireGit(
        ["checkout", "-b", "feature-branch", "origin/feature-branch"],
        {
          cwd: localDir,
        },
      );
      fs.writeFileSync(
        path.join(localDir, "file.txt"),
        "local divergent change\n",
        "utf8",
      );
      add("file.txt", { cwd: localDir });
      commit("local-only commit", { cwd: localDir });
      requireGit(["checkout", "main"], { cwd: localDir });

      checkoutExistingBranch("feature-branch", { cwd: localDir });

      const localSha = requireGit(["rev-parse", "feature-branch"], {
        cwd: localDir,
      });
      const remoteSha = requireGit(["rev-parse", "main"], { cwd: repoDir });
      expect(localSha).toBe(remoteSha);

      fs.rmSync(localDir, { recursive: true, force: true });
    });
  });

  describe("cloneWorkspace", () => {
    test("copies workspace contents to a new directory", () => {
      const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), "git-clone-"));
      fs.rmSync(targetDir, { recursive: true, force: true });

      cloneWorkspace(repoDir, targetDir);

      expect(fs.existsSync(path.join(targetDir, "file.txt"))).toBe(true);
      expect(fs.readFileSync(path.join(targetDir, "file.txt"), "utf8")).toBe(
        "hello\n",
      );

      fs.rmSync(targetDir, { recursive: true, force: true });
    });
  });

  describe("fetchBranches / fetchTags / fetchBranchesAndTags / fetchTargetBranch", () => {
    test("fetch functions run without throwing when a remote is configured", () => {
      const localDir = fs.mkdtempSync(path.join(os.tmpdir(), "git-local-"));
      fs.rmSync(localDir, { recursive: true, force: true });
      requireGit(["clone", repoDir, localDir]);

      try {
        expect(() => fetchBranches({ cwd: localDir })).not.toThrow();
        expect(() => fetchTags({ cwd: localDir })).not.toThrow();
        expect(() => fetchBranchesAndTags({ cwd: localDir })).not.toThrow();
        expect(() =>
          fetchTargetBranch("main", { cwd: localDir }),
        ).not.toThrow();
      } finally {
        fs.rmSync(localDir, { recursive: true, force: true });
      }
    });
  });

  describe("configSafeDirectory", () => {
    test("runs without throwing", () => {
      expect(() => configSafeDirectory(repoDir)).not.toThrow();
    });
  });

  describe("configUser", () => {
    let originalName: string | undefined;
    let originalEmail: string | undefined;

    beforeEach(() => {
      try {
        originalName = requireGit(["config", "--global", "user.name"]);
      } catch {
        originalName = undefined;
      }
      try {
        originalEmail = requireGit(["config", "--global", "user.email"]);
      } catch {
        originalEmail = undefined;
      }
    });

    afterEach(() => {
      if (originalName !== undefined) {
        requireGit(["config", "--global", "user.name", originalName]);
      }
      if (originalEmail !== undefined) {
        requireGit(["config", "--global", "user.email", originalEmail]);
      }
    });

    test("sets global user.name and user.email", () => {
      configUser("test-actor");
      expect(requireGit(["config", "--global", "user.name"])).toBe(
        "test-actor",
      );
      expect(requireGit(["config", "--global", "user.email"])).toBe(
        "test-actor@users.noreply.github.com",
      );
    });
  });

  describe("configGitHttpAuth", () => {
    const fakeHost = "https://git.example.test";
    const fakeToken = "test-token-xyz";

    afterEach(() => {
      execGit([
        "config",
        "--global",
        "--unset-all",
        `url.https://x-access-token:${fakeToken}@git.example.test/.insteadOf`,
      ]);
    });

    test("sets the global URL insteadOf rewrite rule", () => {
      configGitHttpAuth(fakeHost, fakeToken);
      const value = requireGit([
        "config",
        "--global",
        "--get",
        `url.https://x-access-token:${fakeToken}@git.example.test/.insteadOf`,
      ]);
      expect(value).toBe("https://git.example.test/");
    });
  });

  describe("listTagsSortedByVersionDescending", () => {
    test("returns empty array when no tags exist", () => {
      expect(listTagsSortedByVersionDescending({ cwd: repoDir })).toEqual([]);
    });

    test("returns tags sorted by version descending", () => {
      requireGit(["tag", "v1.0.0"], { cwd: repoDir });
      requireGit(["tag", "v2.0.0"], { cwd: repoDir });
      requireGit(["tag", "v0.9.0"], { cwd: repoDir });
      const tags = listTagsSortedByVersionDescending({ cwd: repoDir });
      expect(tags[0]).toBe("v2.0.0");
      expect(tags).toContain("v1.0.0");
      expect(tags).toContain("v0.9.0");
    });
  });

  describe("getHeadSha", () => {
    test("returns a 40-character hex SHA", () => {
      expect(getHeadSha({ cwd: repoDir })).toMatch(/^[0-9a-f]{40}$/);
    });
  });

  describe("gitLog", () => {
    test("returns commit subjects for the given range", () => {
      const log = gitLog("HEAD", "%s", 10, { cwd: repoDir });
      expect(log).toContain("initial commit");
    });

    test("throws when the range is invalid", () => {
      expect(() =>
        gitLog("nonexistent..HEAD", "%s", 10, { cwd: repoDir }),
      ).toThrow();
    });
  });

  describe("hasDiffAgainstRef", () => {
    test("returns false when the file matches HEAD", () => {
      expect(hasDiffAgainstRef("HEAD", "file.txt", { cwd: repoDir })).toBe(
        false,
      );
    });

    test("returns true when the file differs from HEAD", () => {
      fs.writeFileSync(path.join(repoDir, "file.txt"), "changed\n", "utf8");
      add("file.txt", { cwd: repoDir });
      expect(hasDiffAgainstRef("HEAD", "file.txt", { cwd: repoDir })).toBe(
        true,
      );
    });
  });

  describe("pullTargetBranch", () => {
    test("pulls new commits from origin", () => {
      const localDir = fs.mkdtempSync(path.join(os.tmpdir(), "git-local-"));
      fs.rmSync(localDir, { recursive: true, force: true });
      requireGit(["clone", repoDir, localDir]);

      fs.writeFileSync(
        path.join(repoDir, "new-file.txt"),
        "from origin\n",
        "utf8",
      );
      add("new-file.txt", { cwd: repoDir });
      commit("add new-file.txt", { cwd: repoDir });

      pullTargetBranch("main", { cwd: localDir });

      expect(fs.existsSync(path.join(localDir, "new-file.txt"))).toBe(true);
      fs.rmSync(localDir, { recursive: true, force: true });
    });
  });

  describe("checkoutBranchFromTarget", () => {
    test("creates a local branch pointing to origin/main", () => {
      const localDir = fs.mkdtempSync(path.join(os.tmpdir(), "git-local-"));
      fs.rmSync(localDir, { recursive: true, force: true });
      requireGit(["clone", repoDir, localDir]);
      requireGit(["config", "user.name", "test-actor"], { cwd: localDir });
      requireGit(
        ["config", "user.email", "test-actor@users.noreply.github.com"],
        { cwd: localDir },
      );

      checkoutBranchFromTarget("new-feature", "main", { cwd: localDir });

      expect(
        requireGit(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: localDir }),
      ).toBe("new-feature");
      fs.rmSync(localDir, { recursive: true, force: true });
    });
  });

  describe("pushBranch", () => {
    test("pushes a local branch to origin", () => {
      const localDir = fs.mkdtempSync(path.join(os.tmpdir(), "git-local-"));
      fs.rmSync(localDir, { recursive: true, force: true });
      requireGit(["clone", repoDir, localDir]);
      requireGit(["config", "user.name", "test-actor"], { cwd: localDir });
      requireGit(
        ["config", "user.email", "test-actor@users.noreply.github.com"],
        { cwd: localDir },
      );

      requireGit(["checkout", "-b", "push-test-branch"], { cwd: localDir });
      fs.writeFileSync(path.join(localDir, "pushed.txt"), "pushed\n", "utf8");
      add("pushed.txt", { cwd: localDir });
      commit("add pushed.txt", { cwd: localDir });

      pushBranch("push-test-branch", { cwd: localDir });

      const branches = requireGit(["branch", "--list"], { cwd: repoDir });
      expect(branches).toContain("push-test-branch");
      fs.rmSync(localDir, { recursive: true, force: true });
    });
  });
});
