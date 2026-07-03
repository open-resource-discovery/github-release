import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  add,
  branchExistsRemote,
  checkoutExistingBranch,
  cloneWorkspace,
  commit,
  execGit,
  hasUnstagedChanges,
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
});
