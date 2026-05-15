import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function writeExecutable(filePath: string, content: string): void {
  fs.writeFileSync(filePath, content.replace(/\r\n/g, "\n"), "utf8");
  fs.chmodSync(filePath, 0o755);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function toShellPath(value: string): string {
  return value.replace(/\\/g, "/");
}

function getCurrentPath(): string {
  return process.env.PATH ?? process.env.Path ?? process.env.path ?? "";
}

function resolvePosixShell(): string {
  const candidates = [
    process.env.SHELL,
    "/bin/sh",
    "/usr/bin/sh",
    "/usr/local/bin/sh",
    "C:\\Program Files\\Git\\bin\\sh.exe",
    "C:\\Program Files\\Git\\usr\\bin\\sh.exe",
    "C:\\Program Files (x86)\\Git\\bin\\sh.exe",
    "C:\\Program Files (x86)\\Git\\usr\\bin\\sh.exe",
    "C:\\msys64\\usr\\bin\\sh.exe",
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  if (process.platform === "win32") {
    const whereResult = spawnSync("where.exe", ["sh"], {
      encoding: "utf8",
      env: process.env,
    });

    if (whereResult.status === 0) {
      const shellPath = whereResult.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.length > 0 && fs.existsSync(line));

      if (shellPath) {
        return shellPath;
      }
    }
  }

  throw new Error(
    "POSIX shell not found. Install Git Bash or run these script tests on Linux/macOS.",
  );
}

function buildChildEnv(env: Record<string, string>): NodeJS.ProcessEnv {
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...env,
  };

  delete childEnv.Path;
  delete childEnv.path;
  childEnv.PATH = getCurrentPath();

  return childEnv;
}

export function runSourcedShellScript(input: {
  scriptRelativePath: string;
  cwd: string;
  binDir: string;
  env: Record<string, string>;
}): void {
  const sourceScriptPath = path.join(process.cwd(), input.scriptRelativePath);
  const localScriptPath = path.join(input.cwd, "script-under-test.sh");

  const scriptContent = fs
    .readFileSync(sourceScriptPath, "utf8")
    .replace(/\r\n/g, "\n");

  fs.writeFileSync(localScriptPath, scriptContent, "utf8");
  fs.chmodSync(localScriptPath, 0o755);

  const shell = resolvePosixShell();
  const relativeBinDir = toShellPath(path.relative(input.cwd, input.binDir));
  const shellCommand = [
    `PATH=${shellQuote(relativeBinDir)}:$PATH`,
    "export PATH",
    ". ./script-under-test.sh",
  ].join("\n");

  const result = spawnSync(shell, ["-c", shellCommand], {
    cwd: input.cwd,
    env: buildChildEnv(input.env),
    encoding: "utf8",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      [
        `Script failed: ${input.scriptRelativePath}`,
        `Exit code: ${String(result.status)}`,
        "STDOUT:",
        result.stdout,
        "STDERR:",
        result.stderr,
      ].join("\n"),
    );
  }
}