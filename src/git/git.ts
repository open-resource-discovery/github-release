import { spawnSync } from "node:child_process";
import * as fs from "node:fs";

export type GitCommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type GitOptions = {
  cwd?: string;
};

export function execGit(
  args: string[],
  options: GitOptions = {},
): GitCommandResult {
  const result = spawnSync("git", args, {
    cwd: options.cwd,
    encoding: "utf8",
  });

  if (result.error) {
    throw new Error(
      `Failed to execute "git ${args.join(" ")}": ${result.error.message}`,
    );
  }

  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 1,
  };
}

export function requireGit(args: string[], options: GitOptions = {}): string {
  const result = execGit(args, options);

  if (result.exitCode !== 0) {
    throw new Error(
      [
        `git ${args.join(" ")} failed with exit code ${result.exitCode}.`,
        `stdout: ${result.stdout.trim()}`,
        `stderr: ${result.stderr.trim()}`,
      ].join("\n"),
    );
  }

  return result.stdout.trim();
}

export interface GitPort {
  configSafeDirectory(workspace: string): void;
  configUser(actor: string): void;
  configGitHttpAuth(githubServerUrl: string, token: string): void;
  fetchBranches(options?: GitOptions): void;
  fetchTags(options?: GitOptions): void;
  fetchBranchesAndTags(options?: GitOptions): void;
  fetchTargetBranch(targetBranch: string, options?: GitOptions): void;
  tagList(options?: GitOptions): string[];
  listTagsSortedByVersionDescending(options?: GitOptions): string[];
  revParse(ref: string, options?: GitOptions): string | undefined;
  tagExists(tag: string, options?: GitOptions): boolean;
  getHeadSha(options?: GitOptions): string;
  gitLog(
    range: string,
    format: string,
    maxCount: number,
    options?: GitOptions,
  ): string;
  hasDiffAgainstRef(
    ref: string,
    filePath: string,
    options?: GitOptions,
  ): boolean;
  hasUnstagedChanges(filePath: string, options?: GitOptions): boolean;
  pullTargetBranch(targetBranch: string, options?: GitOptions): void;
  checkoutBranchFromTarget(
    branchName: string,
    targetBranch: string,
    options?: GitOptions,
  ): void;
  checkoutExistingBranch(branchName: string, options?: GitOptions): void;
  branchExistsRemote(branchName: string, options?: GitOptions): boolean;
  add(filePath: string, options?: GitOptions): void;
  commit(message: string, options?: GitOptions): void;
  pushBranch(branchName: string, options?: GitOptions): void;
  cloneWorkspace(source: string, target: string): void;
}

export function configSafeDirectory(workspace: string): void {
  requireGit(["config", "--global", "--add", "safe.directory", workspace]);
}

export function configUser(actor: string): void {
  requireGit(["config", "--global", "user.name", actor]);
  requireGit([
    "config",
    "--global",
    "user.email",
    `${actor}@users.noreply.github.com`,
  ]);
}

export function configGitHttpAuth(
  githubServerUrl: string,
  token: string,
): void {
  const host = githubServerUrl.replace(/^https?:\/\//, "");
  requireGit([
    "config",
    "--global",
    `url.https://x-access-token:${token}@${host}/.insteadOf`,
    `https://${host}/`,
  ]);
}

export function fetchBranches(options: GitOptions = {}): void {
  requireGit(
    ["fetch", "--prune", "origin", "+refs/heads/*:refs/remotes/origin/*"],
    options,
  );
}

export function fetchTags(options: GitOptions = {}): void {
  requireGit(
    ["fetch", "--prune", "--prune-tags", "origin", "+refs/tags/*:refs/tags/*"],
    options,
  );
}

export function fetchBranchesAndTags(options: GitOptions = {}): void {
  fetchBranches(options);
  fetchTags(options);
}

export function fetchTargetBranch(
  targetBranch: string,
  options: GitOptions = {},
): void {
  requireGit(["fetch", "origin", targetBranch], options);
}

export function tagList(options: GitOptions = {}): string[] {
  const output = requireGit(["tag", "--list"], options);
  return output.split("\n").filter((line) => line.length > 0);
}

export function listTagsSortedByVersionDescending(
  options: GitOptions = {},
): string[] {
  const output = requireGit(
    ["tag", "--list", "--sort=-version:refname"],
    options,
  );
  return output.split("\n").filter((line) => line.length > 0);
}

export function revParse(
  ref: string,
  options: GitOptions = {},
): string | undefined {
  const result = execGit(["rev-parse", "--verify", ref], options);

  if (result.exitCode !== 0) {
    return undefined;
  }

  return result.stdout.trim();
}

export function tagExists(tag: string, options: GitOptions = {}): boolean {
  return revParse(`refs/tags/${tag}`, options) !== undefined;
}

export function getHeadSha(options: GitOptions = {}): string {
  return requireGit(["rev-parse", "HEAD"], options);
}

export function gitLog(
  range: string,
  format: string,
  maxCount: number,
  options: GitOptions = {},
): string {
  const result = execGit(
    ["log", range, `--max-count=${maxCount}`, `--pretty=format:${format}`],
    options,
  );

  if (result.exitCode !== 0) {
    throw new Error(
      [
        `git log ${range} failed with exit code ${result.exitCode}.`,
        `stderr: ${result.stderr.trim()}`,
      ].join("\n"),
    );
  }

  return result.stdout;
}

export function hasDiffAgainstRef(
  ref: string,
  filePath: string,
  options: GitOptions = {},
): boolean {
  const result = execGit(["diff", "--quiet", ref, "--", filePath], options);
  return result.exitCode !== 0;
}

export function hasUnstagedChanges(
  filePath: string,
  options: GitOptions = {},
): boolean {
  const result = execGit(["diff", "--quiet", "--", filePath], options);
  return result.exitCode !== 0;
}

export function pullTargetBranch(
  targetBranch: string,
  options: GitOptions = {},
): void {
  requireGit(["pull", "origin", targetBranch], options);
}

export function checkoutBranchFromTarget(
  branchName: string,
  targetBranch: string,
  options: GitOptions = {},
): void {
  requireGit(["checkout", "-b", branchName, `origin/${targetBranch}`], options);
}

export function checkoutExistingBranch(
  branchName: string,
  options: GitOptions = {},
): void {
  // The local clone may not have a ref for this branch at all (e.g. a fresh
  // workspace copy that only ever fetched the target branch), so fetch it
  // explicitly before checking it out instead of assuming a local/remote-
  // tracking ref already exists.
  requireGit(
    ["fetch", "origin", `${branchName}:refs/remotes/origin/${branchName}`],
    options,
  );
  // `checkout -B` creates the local branch if missing, or resets it to match
  // origin if it already exists — avoids rebase conflicts in the ephemeral
  // temp-dir clone this is always run against.
  requireGit(["checkout", "-B", branchName, `origin/${branchName}`], options);
}

export function branchExistsRemote(
  branchName: string,
  options: GitOptions = {},
): boolean {
  const result = execGit(
    ["ls-remote", "--exit-code", "--heads", "origin", branchName],
    options,
  );
  return result.exitCode === 0;
}

export function add(filePath: string, options: GitOptions = {}): void {
  requireGit(["add", "--", filePath], options);
}

export function commit(message: string, options: GitOptions = {}): void {
  const result = execGit(["commit", "-m", message], options);

  if (result.exitCode !== 0) {
    const combinedOutput = `${result.stdout}\n${result.stderr}`;

    if (/nothing to commit/i.test(combinedOutput)) {
      return;
    }

    throw new Error(
      [
        `git commit failed with exit code ${result.exitCode}.`,
        `stdout: ${result.stdout.trim()}`,
        `stderr: ${result.stderr.trim()}`,
      ].join("\n"),
    );
  }
}

export function pushBranch(branchName: string, options: GitOptions = {}): void {
  requireGit(["push", "origin", branchName], options);
}

export function cloneWorkspace(source: string, target: string): void {
  fs.cpSync(source, target, { recursive: true });
}
