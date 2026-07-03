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

export type ShellFunctionResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

/**
 * Sources a shell script (with CHANGELOG_UPDATED=false to skip its main body),
 * then runs optional setup shell code to override functions, then calls the
 * named function. Returns stdout/stderr/exitCode without throwing so tests can
 * assert on both success and failure paths.
 *
 * setup runs AFTER sourcing so its function definitions override the script's.
 */
export function runShellFunction(input: {
  scriptRelativePath: string;
  setup: string;
  functionCall: string;
  cwd: string;
  binDir: string;
  env: Record<string, string>;
}): ShellFunctionResult {
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
    "CHANGELOG_UPDATED=false",
    "export CHANGELOG_UPDATED",
    ". ./script-under-test.sh",
    input.setup,
    input.functionCall,
  ].join("\n");

  const result = spawnSync(shell, ["-c", shellCommand], {
    cwd: input.cwd,
    env: buildChildEnv(input.env),
    encoding: "utf8",
  });

  if (result.error) {
    throw result.error;
  }

  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 1,
  };
}

/**
 * Writes a Node.js-backed jq mock to binDir/jq so tests run on systems where
 * the real jq binary is not installed (e.g. bare Windows). Handles all jq
 * patterns used by create-pr.sh.
 */
export function writeJqMock(binDir: string, cwd: string): void {
  const implPath = path.join(cwd, "jq-impl.js");
  const implPathPosix = toShellPath(implPath);

  const implCode = `'use strict';
const chunks = [];
process.stdin.on('data', d => chunks.push(d));
process.stdin.on('end', () => main(chunks.join('')));

function main(raw) {
  const args = process.argv.slice(2);
  const vars = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--arg') { vars[args[++i]] = args[++i]; }
    else { positional.push(args[i]); }
  }
  const flags = positional.filter(a => /^-[a-zA-Z]/.test(a)).join('');
  // Normalize: jq expressions in create-pr.sh are multi-line shell strings.
  // Collapse all whitespace runs to a single space and trim so regex anchors work.
  const rawExpr = positional.find(a => !a.startsWith('-')) || '.';
  const expr = rawExpr.trim().replace(/\\s+/g, ' ');
  const rawOut = flags.includes('r');
  const noInput = flags.includes('n');
  const exitStatus = flags.includes('e');
  const input = noInput ? null : safeparse(raw);

  if (expr === 'empty') { process.exit(safeparse(raw) !== null ? 0 : 1); }

  if (expr.includes('@uri')) {
    process.stdout.write(encodeURIComponent(vars['value'] || '') + '\\n');
    return;
  }

  const m1 = expr.match(/^\\.([\\w]+) ?\\/\\/ ?(empty|"[^"]*"|null)$/);
  if (m1) {
    const v = input?.[m1[1]];
    if (v == null) { if (m1[2] !== 'empty') write(m1[2].replace(/^"|"$/g, ''), true); }
    else write(v, rawOut);
    return;
  }

  if (expr.includes('| length > 0')) {
    const f = expr.match(/^\\.([\\w]+)/)?.[1];
    const arr = f ? input?.[f] : input;
    const ok = Array.isArray(arr) && arr.length > 0;
    write(ok, rawOut);
    process.exit(ok ? 0 : exitStatus ? 1 : 0);
    return;
  }

  // .array[]? | select(.field == $var) | .result
  const m2 = expr.match(/^\\.([\\w]+)\\[\\]\\?? \\| select\\(\\.([\\w]+) == \\$([\\w]+)\\) \\| \\.([\\w]+)/);
  if (m2) {
    (input?.[m2[1]] || []).filter(it => String(it[m2[2]]) === String(vars[m2[3]])).forEach(it => write(it[m2[4]], rawOut));
    return;
  }

  // .array[]? | select(.f1 == $v1 and .f2 >= $v2) | .result
  const m3 = expr.match(/^\\.([\\w]+)\\[\\]\\?? \\| select\\(\\.([\\w]+) == \\$([\\w]+) and \\.([\\w]+) >= \\$([\\w]+)\\) \\| \\.([\\w]+)/);
  if (m3) {
    (input?.[m3[1]] || []).filter(it =>
      String(it[m3[2]]) === String(vars[m3[3]]) && String(it[m3[4]]) >= String(vars[m3[5]])
    ).forEach(it => write(it[m3[6]], rawOut));
    return;
  }

  if (expr.includes('@tsv')) {
    const f = expr.match(/^\\.([\\w]+)\\[\\]/)?.[1];
    (f ? (input?.[f] || []) : []).forEach(it => {
      process.stdout.write([it.name || '', it.conclusion || 'failure', it.html_url || ''].join('\\t') + '\\n');
    });
    return;
  }

  if (noInput) {
    if (expr.includes('head_sha') && expr.includes('conclusion')) {
      const result = {
        name: vars.name, head_sha: vars.head_sha,
        status: 'completed', conclusion: vars.conclusion,
        output: { title: vars.name, summary: vars.summary }
      };
      if (vars.details_url) result.details_url = vars.details_url;
      write(result, rawOut);
    } else {
      const result = {};
      for (const [k, v] of Object.entries(vars)) result[k] = v;
      write(result, rawOut);
    }
    return;
  }

  if (expr.includes('"') && expr.includes('\\\\(')) {
    const f = expr.match(/^\\.([\\w]+)\\[\\]/)?.[1];
    (f ? (input?.[f] || []) : []).forEach(it => {
      const s = expr.replace(/^[^"]*"/, '').replace(/"[^"]*$/, '')
        .replace(/\\\\\\(([^)]+)\\)/g, (_, p) => {
          const val = p.trim().split('.').reduce((o, k) => k ? o?.[k] : o, it);
          return val == null ? 'null' : String(val);
        });
      write(s, true);
    });
    return;
  }

  if (expr === '.') { write(input, rawOut); }
}

function safeparse(s) { try { return JSON.parse(s || 'null'); } catch { return null; } }
function write(v, raw) {
  if (v === null || v === undefined) return;
  process.stdout.write((raw ? String(v) : JSON.stringify(v, null, 2)) + '\\n');
}
`;

  fs.writeFileSync(implPath, implCode, "utf8");

  writeExecutable(
    path.join(binDir, "jq"),
    `#!/bin/sh\nexec node '${implPathPosix}' "$@"\n`,
  );
}
