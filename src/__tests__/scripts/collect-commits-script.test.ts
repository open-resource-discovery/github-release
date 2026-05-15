import * as fs from "node:fs";
import path from "node:path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import {
  createTempDir,
  runSourcedShellScript,
  writeExecutable,
} from "./test-utils.js";

describe("collect-commits.sh", () => {
  let tempDir: string;
  let binDir: string;

  beforeEach(() => {
    tempDir = createTempDir("github-release-collect-commits-");
    binDir = path.join(tempDir, "bin");
    fs.mkdirSync(binDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("deduplicates contributors by GitHub login when different emails are used", () => {
    writeExecutable(
      path.join(binDir, "git"),
      `#!/bin/sh
sep=$(printf '\\037')

if [ "$1" = "fetch" ]; then
  exit 0
fi

if [ "$1" = "tag" ] && [ "$2" = "--list" ]; then
  printf '%s\\n' "v1.0.0"
  exit 0
fi

if [ "$1" = "log" ]; then
  printf '%s\\n' "sha-one\${sep}1111111\${sep}Alice\${sep}alice-work@example.com\${sep}First change"
  printf '%s\\n' "sha-two\${sep}2222222\${sep}Alice\${sep}alice-private@example.com\${sep}Second change"
  exit 0
fi

printf '%s\\n' "unexpected git call: $*" >&2
exit 1
`,
    );

    writeExecutable(
      path.join(binDir, "curl"),
      `#!/bin/sh
case "$*" in
  *sha-one*|*sha-two*)
    printf '%s\\n' '{"author":{"login":"alice"}}'
    ;;
  *)
    printf '%s\\n' '{"author":null}'
    ;;
esac
`,
    );

    writeExecutable(
      path.join(binDir, "jq"),
      `#!/bin/sh
input=$(cat)

if [ "$1" = "empty" ]; then
  exit 0
fi

if [ "$1" = "-r" ]; then
  printf '%s\\n' "$input" | sed -n 's/.*"login":"\\([^"]*\\)".*/\\1/p'
  exit 0
fi

exit 0
`,
    );

    runSourcedShellScript({
      scriptRelativePath: "scripts/collect-commits.sh",
      cwd: tempDir,
      binDir,
      env: {
        DRY_RUN: "false",
        RELEASE_EXISTS: "false",
        GITHUB_SERVER_URL: "https://github.com",
        GITHUB_API_URL: "https://api.github.com",
        GITHUB_REPOSITORY: "open-resource-discovery/github-release",
        GITHUB_TOKEN: "test-token",
        TAG: "v1.1.0",
        TAG_EXISTS: "false",
      },
    });

    expect(fs.readFileSync(path.join(tempDir, "contributors.txt"), "utf8")).toBe(
      "@alice\n",
    );

    expect(fs.readFileSync(path.join(tempDir, "commit_log.txt"), "utf8")).toBe(
      [
        "* First change by @alice in [1111111](https://github.com/open-resource-discovery/github-release/commit/sha-one)",
        "* Second change by @alice in [2222222](https://github.com/open-resource-discovery/github-release/commit/sha-two)",
        "",
      ].join("\n"),
    );
  });

  test("does not create contributor mention for commits without GitHub login", () => {
    writeExecutable(
      path.join(binDir, "git"),
      `#!/bin/sh
sep=$(printf '\\037')

if [ "$1" = "fetch" ]; then
  exit 0
fi

if [ "$1" = "tag" ] && [ "$2" = "--list" ]; then
  printf '%s\\n' "v1.0.0"
  exit 0
fi

if [ "$1" = "log" ]; then
  printf '%s\\n' "sha-one\${sep}1111111\${sep}Bob\${sep}bob@example.com\${sep}Fallback change"
  exit 0
fi

printf '%s\\n' "unexpected git call: $*" >&2
exit 1
`,
    );

    writeExecutable(
      path.join(binDir, "curl"),
      `#!/bin/sh
printf '%s\\n' '{"author":null}'
`,
    );

    writeExecutable(
      path.join(binDir, "jq"),
      `#!/bin/sh
input=$(cat)

if [ "$1" = "empty" ]; then
  exit 0
fi

if [ "$1" = "-r" ]; then
  printf '%s\\n' "$input" | sed -n 's/.*"login":"\\([^"]*\\)".*/\\1/p'
  exit 0
fi

exit 0
`,
    );

    runSourcedShellScript({
      scriptRelativePath: "scripts/collect-commits.sh",
      cwd: tempDir,
      binDir,
      env: {
        DRY_RUN: "false",
        RELEASE_EXISTS: "false",
        GITHUB_SERVER_URL: "https://github.com",
        GITHUB_API_URL: "https://api.github.com",
        GITHUB_REPOSITORY: "open-resource-discovery/github-release",
        GITHUB_TOKEN: "test-token",
        TAG: "v1.1.0",
        TAG_EXISTS: "false",
      },
    });

    expect(fs.readFileSync(path.join(tempDir, "contributors.txt"), "utf8")).toBe(
      "\n",
    );

    expect(fs.readFileSync(path.join(tempDir, "commit_log.txt"), "utf8")).toBe(
      "* Fallback change by Bob in [1111111](https://github.com/open-resource-discovery/github-release/commit/sha-one)\n",
    );
  });

  test("does not mention bot contributors", () => {
    writeExecutable(
      path.join(binDir, "git"),
      `#!/bin/sh
sep=$(printf '\\037')

if [ "$1" = "fetch" ]; then
  exit 0
fi

if [ "$1" = "tag" ] && [ "$2" = "--list" ]; then
  printf '%s\\n' "v1.0.0"
  exit 0
fi

if [ "$1" = "log" ]; then
  printf '%s\\n' "sha-bot\${sep}3333333\${sep}dependabot[bot]\${sep}dependabot[bot]@users.noreply.github.com\${sep}Dependency update"
  exit 0
fi

printf '%s\\n' "unexpected git call: $*" >&2
exit 1
`,
    );

    writeExecutable(
      path.join(binDir, "curl"),
      `#!/bin/sh
printf '%s\\n' '{"author":{"login":"dependabot"}}'
`,
    );

    writeExecutable(
      path.join(binDir, "jq"),
      `#!/bin/sh
input=$(cat)

if [ "$1" = "empty" ]; then
  exit 0
fi

if [ "$1" = "-r" ]; then
  printf '%s\\n' "$input" | sed -n 's/.*"login":"\\([^"]*\\)".*/\\1/p'
  exit 0
fi

exit 0
`,
    );

    runSourcedShellScript({
      scriptRelativePath: "scripts/collect-commits.sh",
      cwd: tempDir,
      binDir,
      env: {
        DRY_RUN: "false",
        RELEASE_EXISTS: "false",
        GITHUB_SERVER_URL: "https://github.com",
        GITHUB_API_URL: "https://api.github.com",
        GITHUB_REPOSITORY: "open-resource-discovery/github-release",
        GITHUB_TOKEN: "test-token",
        TAG: "v1.1.0",
        TAG_EXISTS: "false",
      },
    });

    expect(fs.readFileSync(path.join(tempDir, "contributors.txt"), "utf8")).toBe(
      "\n",
    );

    expect(fs.readFileSync(path.join(tempDir, "commit_log.txt"), "utf8")).toBe(
      "* Dependency update by dependabot[bot] in [3333333](https://github.com/open-resource-discovery/github-release/commit/sha-bot)\n",
    );
  });
});