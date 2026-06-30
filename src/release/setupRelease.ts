import * as path from "node:path";
import type { ActionConfig } from "../config.js";
import type { GitOptions, GitPort } from "../git/git.js";
import type { GitHubClient } from "../github/client.js";
import { ensureTextFile, fileExists, readTextFile } from "../utils/files.js";
import { info } from "../utils/log.js";
import { parseRepositoryCoordinates } from "../utils/repository.js";

export type ReleaseSetup = {
  version: string;
  tag: string;
  releaseTitle: string;
  tagExists: boolean;
  releaseExists: boolean;
  latestTag?: string;
  targetBranch: string;
};

const DEFAULT_CHANGELOG_CONTENT =
  "## [unreleased]\n\n### Added\n- Placeholder changelog\n";

function ensureChangelogExists(config: ActionConfig): void {
  const changelogPath = path.join(
    config.githubWorkspace,
    config.changelogFilePath,
  );

  if (fileExists(changelogPath)) {
    return;
  }

  info(`File not found: ${config.changelogFilePath}`);
  info("Creating a default changelog file...");

  if (config.dryRun) {
    info("Dry-Run: Skipping file creation.");
    return;
  }

  ensureTextFile(changelogPath, DEFAULT_CHANGELOG_CONTENT);
}

function resolveVersion(config: ActionConfig): string {
  if (config.versionOverride !== undefined) {
    info(`Using custom version override: ${config.versionOverride}`);
    return config.versionOverride;
  }

  const packageJsonPath = path.join(config.githubWorkspace, "package.json");

  if (fileExists(packageJsonPath)) {
    const parsed: unknown = JSON.parse(readTextFile(packageJsonPath));

    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "version" in parsed &&
      typeof parsed.version === "string" &&
      (parsed as { version: string }).version !== ""
    ) {
      return (parsed as { version: string }).version;
    }
  }

  throw new Error(
    'Mandatory "version" parameter has not been specified. Please check GitHub Action configuration.',
  );
}

function resolveTag(tagTemplate: string, version: string): string {
  return tagTemplate.replace("<version>", version);
}

function resolveReleaseTitle(config: ActionConfig, version: string): string {
  if (config.releaseTitlePrefix !== "") {
    return `${config.releaseTitlePrefix} v${version}`;
  }

  return `v${version}`;
}

function resolveLatestTag(
  git: GitPort,
  tagTemplate: string,
  options: GitOptions,
): string | undefined {
  const pattern = tagTemplate.replace("<version>", "");
  const patternRegex = new RegExp(pattern);
  const sortedTags = git.listTagsSortedByVersionDescending(options);

  return sortedTags.find((tag) => patternRegex.test(tag));
}

function resolveTargetBranch(config: ActionConfig): string {
  return config.githubBaseRef ?? config.githubRefName ?? "main";
}

export async function setupRelease(
  config: ActionConfig,
  git: GitPort,
  client: GitHubClient,
): Promise<ReleaseSetup> {
  git.configSafeDirectory(config.githubWorkspace);
  git.configUser(config.githubActor);

  if (config.githubToken !== "" && config.githubServerUrl !== "") {
    git.configGitHttpAuth(config.githubServerUrl, config.githubToken);
  }

  ensureChangelogExists(config);

  const version = resolveVersion(config);
  const tag = resolveTag(config.tagTemplate, version);
  const releaseTitle = resolveReleaseTitle(config, version);

  info(`Version set to: ${version} (${tag})`);

  const gitOptions: GitOptions = { cwd: config.githubWorkspace };

  if (!config.dryRun) {
    git.fetchBranchesAndTags(gitOptions);
  }

  const tagExists =
    git.tagExists(tag, gitOptions) || git.tagExists(`ms/${tag}`, gitOptions);

  let releaseExists = false;

  if (tagExists) {
    const { owner, repo } = parseRepositoryCoordinates(config.githubRepository);
    const release = await client.getReleaseByTag(owner, repo, tag);
    releaseExists = release !== undefined;
  }

  const latestTag = resolveLatestTag(git, config.tagTemplate, gitOptions);
  const targetBranch = resolveTargetBranch(config);

  return {
    version,
    tag,
    releaseTitle,
    tagExists,
    releaseExists,
    latestTag,
    targetBranch,
  };
}
