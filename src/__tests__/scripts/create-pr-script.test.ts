import * as fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  createTempDir,
  runShellFunction,
  writeExecutable,
  writeJqMock,
} from "./test-utils.js";

const SCRIPT = "scripts/create-pr.sh";

const BASE_ENV = {
  GITHUB_TOKEN: "test-token",
  GITHUB_API_URL: "https://api.github.com",
  GITHUB_REPOSITORY: "owner/repo",
  GITHUB_WORKFLOW_REF:
    "owner/repo/.github/workflows/release.yml@refs/heads/main",
  GITHUB_ENV: "/dev/null",
  CI_WORKFLOWS: "auto",
  VERSION: "1.0.0",
  DRY_RUN: "false",
};

// ---------------------------------------------------------------------------
// Auto-discovery tests (resolve_ci_workflows — no jq needed)
// ---------------------------------------------------------------------------
describe("create-pr.sh — auto-discovery", () => {
  let tempDir: string;
  let binDir: string;

  beforeEach(() => {
    tempDir = createTempDir("github-release-create-pr-");
    binDir = path.join(tempDir, "bin");
    fs.mkdirSync(binDir);
    fs.mkdirSync(path.join(tempDir, ".github", "workflows"), {
      recursive: true,
    });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("finds workflow that declares workflow_dispatch", () => {
    fs.writeFileSync(
      path.join(tempDir, ".github", "workflows", "dummy-ci.yml"),
      [
        "on:",
        "  workflow_dispatch:",
        "jobs:",
        "  test:",
        "    runs-on: ubuntu-latest",
      ].join("\n"),
      "utf8",
    );

    const result = runShellFunction({
      scriptRelativePath: SCRIPT,
      setup: "",
      functionCall: "resolve_ci_workflows",
      cwd: tempDir,
      binDir,
      env: BASE_ENV,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("dummy-ci.yml");
  });

  test("skips the release workflow itself", () => {
    fs.writeFileSync(
      path.join(tempDir, ".github", "workflows", "release.yml"),
      [
        "on:",
        "  push:",
        "  workflow_dispatch:",
        "jobs:",
        "  release:",
        "    runs-on: ubuntu-latest",
      ].join("\n"),
      "utf8",
    );

    fs.writeFileSync(
      path.join(tempDir, ".github", "workflows", "ci.yml"),
      [
        "on:",
        "  workflow_dispatch:",
        "jobs:",
        "  test:",
        "    runs-on: ubuntu-latest",
      ].join("\n"),
      "utf8",
    );

    const result = runShellFunction({
      scriptRelativePath: SCRIPT,
      setup: "",
      functionCall: "resolve_ci_workflows",
      cwd: tempDir,
      binDir,
      env: {
        ...BASE_ENV,
        GITHUB_WORKFLOW_REF:
          "owner/repo/.github/workflows/release.yml@refs/heads/main",
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("ci.yml");
    expect(result.stdout).not.toContain("release.yml");
  });

  test("does not discover workflow that has no workflow_dispatch trigger", () => {
    fs.writeFileSync(
      path.join(tempDir, ".github", "workflows", "deploy.yml"),
      [
        "on:",
        "  push:",
        "    branches: [main]",
        "jobs:",
        "  deploy:",
        "    runs-on: ubuntu-latest",
      ].join("\n"),
      "utf8",
    );

    const result = runShellFunction({
      scriptRelativePath: SCRIPT,
      setup: "",
      functionCall: "resolve_ci_workflows",
      cwd: tempDir,
      binDir,
      env: BASE_ENV,
    });

    expect(result.exitCode).toBe(0);
    // deploy.yml must not appear; version banner lines are expected noise
    expect(result.stdout).not.toContain("deploy.yml");
    expect(result.stdout).not.toContain(".yml");
  });
});

// ---------------------------------------------------------------------------
// dispatch_configured_ci_workflows tests (require jq)
// ---------------------------------------------------------------------------
describe("create-pr.sh — dispatch_configured_ci_workflows", () => {
  let tempDir: string;
  let binDir: string;

  const PR_HEAD_SHA = "abc123def456abc123def456abc123def456abc1";
  const RUN_ID = 42;
  const BRANCH = "release-changelog-update/1.0.0";

  const RUNS_JSON = JSON.stringify({
    workflow_runs: [
      {
        id: RUN_ID,
        head_sha: PR_HEAD_SHA,
        head_branch: BRANCH,
        status: "completed",
        conclusion: "success",
        created_at: "2024-01-01T00:00:00Z",
        html_url: `https://github.com/owner/repo/actions/runs/${RUN_ID}`,
      },
    ],
  });

  const RUN_STATUS_JSON = JSON.stringify({
    status: "completed",
    conclusion: "success",
  });

  const JOBS_JSON = JSON.stringify({
    jobs: [
      {
        name: "Dummy CI Check",
        conclusion: "success",
        html_url: `https://github.com/owner/repo/actions/runs/${RUN_ID}/jobs/1`,
      },
    ],
  });

  function writeCurlMock(
    overrides: {
      dispatchStatus?: string;
      runsJson?: string;
      runStatusJson?: string;
      jobsJson?: string;
      checkRunStatus?: string;
    } = {},
  ): void {
    const dispatchStatus = overrides.dispatchStatus ?? "204";
    const runsJson = overrides.runsJson ?? RUNS_JSON;
    const runStatusJson = overrides.runStatusJson ?? RUN_STATUS_JSON;
    const jobsJson = overrides.jobsJson ?? JOBS_JSON;
    const checkRunStatus = overrides.checkRunStatus ?? "201";

    // Write each response body as a temp file so the mock can serve them
    const runsFile = path.join(tempDir, "mock-runs.json");
    const runFile = path.join(tempDir, "mock-run.json");
    const jobsFile = path.join(tempDir, "mock-jobs.json");
    const checkFile = path.join(tempDir, "mock-check.json");

    fs.writeFileSync(runsFile, runsJson, "utf8");
    fs.writeFileSync(runFile, runStatusJson, "utf8");
    fs.writeFileSync(jobsFile, jobsJson, "utf8");
    fs.writeFileSync(checkFile, '{"id":99}', "utf8");

    const runsFilePosix = runsFile.replace(/\\/g, "/");
    const runFilePosix = runFile.replace(/\\/g, "/");
    const jobsFilePosix = jobsFile.replace(/\\/g, "/");
    const checkFilePosix = checkFile.replace(/\\/g, "/");

    writeExecutable(
      path.join(binDir, "curl"),
      `#!/bin/sh
# Extract -o <file> and the URL (last non-flag arg) from argument list.
# Matching on the URL only (not $* which includes the request body) avoids
# false matches when a body payload contains paths like /runs/42/jobs/1.
output_file=""
url=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "-o" ]; then
    output_file="$arg"
  fi
  case "$arg" in
    http://*|https://*) url="$arg" ;;
  esac
  prev="$arg"
done

case "$url" in
  */dispatches*)
    [ -n "$output_file" ] && printf '' > "$output_file"
    printf '%s' "${dispatchStatus}"
    ;;
  */runs/*/jobs*)
    [ -n "$output_file" ] && cat '${jobsFilePosix}' > "$output_file"
    printf '%s' "200"
    ;;
  */runs/${RUN_ID}*)
    [ -n "$output_file" ] && cat '${runFilePosix}' > "$output_file"
    printf '%s' "200"
    ;;
  */workflows/*/runs*)
    [ -n "$output_file" ] && cat '${runsFilePosix}' > "$output_file"
    printf '%s' "200"
    ;;
  */check-runs*)
    [ -n "$output_file" ] && cat '${checkFilePosix}' > "$output_file"
    printf '%s' "${checkRunStatus}"
    ;;
  *)
    [ -n "$output_file" ] && printf '' > "$output_file"
    printf '%s' "000"
    ;;
esac
`,
    );
  }

  beforeEach(() => {
    tempDir = createTempDir("github-release-create-pr-dispatch-");
    binDir = path.join(tempDir, "bin");
    fs.mkdirSync(binDir);
    fs.mkdirSync(path.join(tempDir, ".github", "workflows"), {
      recursive: true,
    });

    // Mock sleep so polling loops don't actually wait
    writeExecutable(path.join(binDir, "sleep"), "#!/bin/sh\n");

    writeJqMock(binDir, tempDir);

    fs.writeFileSync(
      path.join(tempDir, ".github", "workflows", "dummy-ci.yml"),
      [
        "on:",
        "  workflow_dispatch:",
        "jobs:",
        "  Dummy CI Check:",
        "    runs-on: ubuntu-latest",
      ].join("\n"),
      "utf8",
    );
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("full happy path: dispatch → find run → wait → create check run with exact job name", () => {
    writeCurlMock();

    const result = runShellFunction({
      scriptRelativePath: SCRIPT,
      setup: "",
      functionCall: `dispatch_configured_ci_workflows '${BRANCH}' '${PR_HEAD_SHA}'`,
      cwd: tempDir,
      binDir,
      env: { ...BASE_ENV, CI_WORKFLOWS: "auto" },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Dispatching workflow: dummy-ci.yml");
    expect(result.stdout).toContain(
      "Workflow dispatched successfully: dummy-ci.yml",
    );
    // Resolving message goes to stderr (function is called via $() so only stdout is captured)
    expect(result.stderr).toContain(
      "Resolving workflow run for dispatched workflow: dummy-ci.yml",
    );
    expect(result.stdout).toContain(`Found dispatched workflow run: ${RUN_ID}`);
    expect(result.stdout).toContain(
      "Created check run 'Dummy CI Check' with conclusion 'success'",
    );
    expect(result.stdout).toContain(PR_HEAD_SHA);
  });

  test("dispatch call sends the changelog branch ref", () => {
    const captureFile = path.join(tempDir, "curl-args.txt");
    const captureFilePosix = captureFile.replace(/\\/g, "/");

    const runsFile = path.join(tempDir, "mock-runs.json");
    const runFile = path.join(tempDir, "mock-run.json");
    const jobsFile = path.join(tempDir, "mock-jobs.json");
    const checkFile = path.join(tempDir, "mock-check.json");
    fs.writeFileSync(runsFile, RUNS_JSON, "utf8");
    fs.writeFileSync(runFile, RUN_STATUS_JSON, "utf8");
    fs.writeFileSync(jobsFile, JOBS_JSON, "utf8");
    fs.writeFileSync(checkFile, '{"id":99}', "utf8");

    const runsFilePosix = runsFile.replace(/\\/g, "/");
    const runFilePosix = runFile.replace(/\\/g, "/");
    const jobsFilePosix = jobsFile.replace(/\\/g, "/");
    const checkFilePosix = checkFile.replace(/\\/g, "/");

    writeExecutable(
      path.join(binDir, "curl"),
      `#!/bin/sh
output_file=""
url=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "-o" ]; then
    output_file="$arg"
  fi
  case "$arg" in
    http://*|https://*) url="$arg" ;;
  esac
  prev="$arg"
done

printf '%s\\n' "$*" >> '${captureFilePosix}'

case "$url" in
  */dispatches*)
    [ -n "$output_file" ] && printf '' > "$output_file"
    printf '%s' "204"
    ;;
  */runs/*/jobs*)
    [ -n "$output_file" ] && cat '${jobsFilePosix}' > "$output_file"
    printf '%s' "200"
    ;;
  */runs/${RUN_ID}*)
    [ -n "$output_file" ] && cat '${runFilePosix}' > "$output_file"
    printf '%s' "200"
    ;;
  */workflows/*/runs*)
    [ -n "$output_file" ] && cat '${runsFilePosix}' > "$output_file"
    printf '%s' "200"
    ;;
  */check-runs*)
    [ -n "$output_file" ] && cat '${checkFilePosix}' > "$output_file"
    printf '%s' "201"
    ;;
  *)
    [ -n "$output_file" ] && printf '' > "$output_file"
    printf '%s' "000"
    ;;
esac
`,
    );

    const result = runShellFunction({
      scriptRelativePath: SCRIPT,
      setup: "",
      functionCall: `dispatch_configured_ci_workflows '${BRANCH}' '${PR_HEAD_SHA}'`,
      cwd: tempDir,
      binDir,
      env: { ...BASE_ENV, CI_WORKFLOWS: "auto" },
    });

    expect(result.exitCode).toBe(0);

    const capturedArgs = fs.readFileSync(captureFile, "utf8");
    // The branch ref is in the -d payload which spans multiple lines when the
    // jq-built JSON is pretty-printed; check the whole capture for the dispatch
    // endpoint and for the raw branch value that appears in the {ref:} body.
    expect(capturedArgs).toContain("dispatches");
    expect(capturedArgs).toContain(BRANCH);
  });

  test("check-run creation includes the changelog PR head SHA", () => {
    writeCurlMock();

    const result = runShellFunction({
      scriptRelativePath: SCRIPT,
      setup: "",
      functionCall: `dispatch_configured_ci_workflows '${BRANCH}' '${PR_HEAD_SHA}'`,
      cwd: tempDir,
      binDir,
      env: { ...BASE_ENV, CI_WORKFLOWS: "auto" },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`for ${PR_HEAD_SHA}`);
  });

  test("fails when no workflow run can be found after polling", () => {
    writeCurlMock();

    // Override find_dispatched_workflow_run_id to return immediately without polling
    const result = runShellFunction({
      scriptRelativePath: SCRIPT,
      setup: String.raw`
find_dispatched_workflow_run_id() {
  echo "Resolving workflow run for dispatched workflow: $1" >&2
  echo "::error::Could not find dispatched workflow run for '$1' on branch '$2' (SHA '$3', since '$4')." >&2
  return 1
}
`,
      functionCall: `dispatch_configured_ci_workflows '${BRANCH}' '${PR_HEAD_SHA}'`,
      cwd: tempDir,
      binDir,
      env: { ...BASE_ENV, CI_WORKFLOWS: "auto" },
    });

    expect(result.exitCode).not.toBe(0);
    // error messages go to stderr (same as the real function when called via $())
    expect(result.stderr).toContain("Could not find dispatched workflow run");
  });

  test("dispatches nothing and succeeds when ci-workflows is none", () => {
    writeCurlMock();

    const result = runShellFunction({
      scriptRelativePath: SCRIPT,
      setup: "",
      functionCall: `dispatch_configured_ci_workflows '${BRANCH}' '${PR_HEAD_SHA}'`,
      cwd: tempDir,
      binDir,
      env: { ...BASE_ENV, CI_WORKFLOWS: "none" },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("No CI workflows configured or discovered");
  });
});
