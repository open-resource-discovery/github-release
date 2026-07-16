import * as path from "node:path";
import type { ActionConfig } from "../config.js";
import type { GitOptions, GitPort } from "../git/git.js";
import { readTextFile } from "../utils/files.js";
import { info } from "../utils/log.js";
import type { CollectedReleaseData } from "./collectCommits.js";
import {
  FALLBACK_DESCRIPTION,
  renderReleaseBody,
} from "./renderReleaseNotes.js";
import type { ReleaseSetup } from "./setupRelease.js";

export type ChangelogResult = {
  updated: boolean;
  changelogFileContent?: string;
  releaseBody: string;
};

function buildVersionHeadingRegexes(version: string): RegExp[] {
  return [
    new RegExp(`^## \\[\\[${version}\\]\\]`),
    new RegExp(`^## \\[\\[${version}\\]\\(.*\\)\\]`),
    new RegExp(`^## \\[${version}\\]`),
  ];
}

function isBlank(value: string): boolean {
  return value.trim() === "";
}

function findNextHeadingIndex(lines: string[], fromIndex: number): number {
  for (let i = fromIndex; i < lines.length; i += 1) {
    if (/^## \[/.test(lines[i])) {
      return i;
    }
  }

  return -1;
}

function extractExistingVersionDescription(
  lines: string[],
  version: string,
): string | undefined {
  const headingRegexes = buildVersionHeadingRegexes(version);
  const startIndex = lines.findIndex((line) =>
    headingRegexes.some((regex) => regex.test(line)),
  );

  if (startIndex === -1) {
    return undefined;
  }

  const nextHeadingIndex = findNextHeadingIndex(lines, startIndex + 1);
  const sliceEnd = nextHeadingIndex === -1 ? lines.length : nextHeadingIndex;

  return lines.slice(startIndex + 1, sliceEnd).join("\n");
}

function splitUnreleasedSection(lines: string[]): {
  header: string;
  unreleasedBody: string;
  rest: string;
} {
  const unreleasedIndex = lines.findIndex((line) =>
    /^## \[unreleased\]/.test(line),
  );

  if (unreleasedIndex === -1) {
    return { header: lines.join("\n"), unreleasedBody: "", rest: "" };
  }

  const header = lines.slice(0, unreleasedIndex).join("\n");
  const nextHeadingIndex = findNextHeadingIndex(lines, unreleasedIndex + 1);

  if (nextHeadingIndex === -1) {
    return {
      header,
      unreleasedBody: lines.slice(unreleasedIndex + 1).join("\n"),
      rest: "",
    };
  }

  return {
    header,
    unreleasedBody: lines
      .slice(unreleasedIndex + 1, nextHeadingIndex)
      .join("\n"),
    rest: lines.slice(nextHeadingIndex).join("\n"),
  };
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function syncChangelogWithRemote(
  config: ActionConfig,
  setup: ReleaseSetup,
  git: GitPort,
  options: GitOptions,
): void {
  git.fetchBranches(options);

  const isOutdated = git.hasDiffAgainstRef(
    `origin/${setup.targetBranch}`,
    config.changelogFilePath,
    options,
  );

  if (isOutdated) {
    info("Local CHANGELOG.md is outdated.");

    if (config.dryRun) {
      info(`Dry-Run: Skipping 'git pull origin ${setup.targetBranch}'.`);
    } else {
      info("Pulling latest changes...");
      git.pullTargetBranch(setup.targetBranch, options);
    }
  } else {
    info("CHANGELOG.md is up to date.");
  }

  const hasLocalChanges = git.hasUnstagedChanges(
    config.changelogFilePath,
    options,
  );

  if (!hasLocalChanges) {
    info(`No changes in ${config.changelogFilePath}`);
    return;
  }

  info("Saving changes before switching branches...");

  if (config.dryRun) {
    info("Dry-Run: Skipping 'git add' and 'git commit'.");
    return;
  }

  git.add(config.changelogFilePath, options);
  git.commit("chore: save changelog changes before branch switch", options);
}

export function updateChangelog(
  config: ActionConfig,
  setup: ReleaseSetup,
  collected: CollectedReleaseData,
  git: GitPort,
): Promise<ChangelogResult> {
  const gitOptions: GitOptions = { cwd: config.githubWorkspace };
  syncChangelogWithRemote(config, setup, git, gitOptions);

  const changelogPath = path.join(
    config.githubWorkspace,
    config.changelogFilePath,
  );
  const lines = readTextFile(changelogPath).split("\n");

  const existingDescription = extractExistingVersionDescription(
    lines,
    setup.version,
  );

  if (existingDescription !== undefined) {
    info(
      `Version ${setup.version} already exists in ${config.changelogFilePath}. Extracting description.`,
    );

    const description = isBlank(existingDescription)
      ? FALLBACK_DESCRIPTION
      : existingDescription;
    const releaseBody = renderReleaseBody(
      description,
      collected.commitLogLines,
      collected.fullChangelogLine,
    );

    return Promise.resolve({ updated: false, releaseBody });
  }

  info(
    `Version ${setup.version} not found in ${config.changelogFilePath}. Updating changelog...`,
  );

  const { header, unreleasedBody, rest } = splitUnreleasedSection(lines);
  const description = isBlank(unreleasedBody)
    ? FALLBACK_DESCRIPTION
    : unreleasedBody;

  const versionLink = `${config.githubServerUrl}/${config.githubRepository}/releases/tag/${setup.tag}`;

  const changelogFileContent =
    (header ? `${header}\n\n` : "") +
    ["## [unreleased]", "", `## [[${setup.version}](${versionLink})] - ${todayDate()}`, description, "", rest].join(
      "\n",
    );

  const releaseBody = renderReleaseBody(
    description,
    collected.commitLogLines,
    collected.fullChangelogLine,
  );

  return Promise.resolve({ updated: true, changelogFileContent, releaseBody });
}
