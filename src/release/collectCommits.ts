import type { ActionConfig } from "../config.js";
import type { GitOptions, GitPort } from "../git/git.js";
import type { GitHubClient, PullRequestSummary } from "../github/client.js";
import { warning } from "../utils/log.js";
import {
  parseRepositoryCoordinates,
  type RepositoryCoordinates,
} from "../utils/repository.js";
import type { ReleaseSetup } from "./setupRelease.js";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export type CollectedReleaseData = {
  commitLogLines: string[];
  fullChangelogLine?: string;
};

const FIELD_SEPARATOR = "\x1f";
const MAX_COMMITS = 30;

type SemverTuple = [number, number, number];

function extractSemver(tag: string): SemverTuple | undefined {
  const match = /^[^0-9]*(\d+)\.(\d+)\.(\d+)/.exec(tag);

  if (!match) {
    return undefined;
  }

  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareSemver(a: SemverTuple, b: SemverTuple): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

function findPrevAndNextSemverTags(
  existingTags: string[],
  targetTag: string,
): { prevSemverTag?: string; nextSemverTag?: string } {
  const entries: { tag: string; semver: SemverTuple }[] = [];

  for (const tag of existingTags) {
    const semver = extractSemver(tag);
    if (semver) {
      entries.push({ tag, semver });
    }
  }

  if (!existingTags.includes(targetTag)) {
    const semver = extractSemver(targetTag);
    if (semver) {
      entries.push({ tag: targetTag, semver });
    }
  }

  entries.sort((a, b) => compareSemver(a.semver, b.semver));

  let prevSemverTag: string | undefined;
  let nextSemverTag: string | undefined;
  let found = false;

  for (const entry of entries) {
    if (entry.tag === targetTag) {
      found = true;
      continue;
    }

    if (!found) {
      prevSemverTag = entry.tag;
    } else if (nextSemverTag === undefined) {
      nextSemverTag = entry.tag;
      break;
    }
  }

  return { prevSemverTag, nextSemverTag };
}

function computeCommitRange(
  setup: ReleaseSetup,
  prevSemverTag: string | undefined,
  nextSemverTag: string | undefined,
): string {
  if (setup.tagExists) {
    return prevSemverTag ? `${prevSemverTag}..${setup.tag}` : setup.tag;
  }

  if (prevSemverTag && nextSemverTag) {
    return `${prevSemverTag}..${nextSemverTag}`;
  }

  if (prevSemverTag) {
    return `${prevSemverTag}..HEAD`;
  }

  return "HEAD";
}

type ParsedCommit = {
  sha: string;
  shortSha: string;
  authorName: string;
  authorEmail: string;
  subject: string;
};

function parseCommitLines(rawLog: string): ParsedCommit[] {
  const commits: ParsedCommit[] = [];

  for (const line of rawLog.split("\n")) {
    if (line.length === 0) {
      continue;
    }

    const [sha, shortSha, authorName, authorEmail, ...subjectParts] =
      line.split(FIELD_SEPARATOR);

    if (
      sha === undefined ||
      sha === "" ||
      shortSha === undefined ||
      authorName === undefined ||
      authorEmail === undefined
    ) {
      continue;
    }

    commits.push({
      sha,
      shortSha,
      authorName,
      authorEmail,
      subject: subjectParts.join(FIELD_SEPARATOR),
    });
  }

  return commits;
}

type ParsedPrReference = {
  prNumber?: string;
  prTitle?: string;
  isMergeCommit: boolean;
};

function parsePrReferenceFromSubject(subject: string): ParsedPrReference {
  const mergeMatch = /[Mm]erge pull request #(\d+)/.exec(subject);

  if (mergeMatch) {
    return { prNumber: mergeMatch[1], isMergeCommit: true };
  }

  const inlineMatch = /\(#(\d+)\)/.exec(subject);

  if (inlineMatch) {
    return { prNumber: inlineMatch[1], isMergeCommit: false };
  }

  return { isMergeCommit: false };
}

async function buildCommitLine(
  commit: ParsedCommit,
  config: ActionConfig,
  repository: RepositoryCoordinates,
  client: GitHubClient,
  seenPrNumbers: Set<string>,
): Promise<string | undefined> {
  const { owner, repo } = repository;
  const commitUrl = `${config.githubServerUrl}/${config.githubRepository}/commit/${commit.sha}`;

  let commitLogin: string | undefined;

  try {
    const commitInfo = await client.getCommit(owner, repo, commit.sha);
    commitLogin = commitInfo.login;
  } catch (error: unknown) {
    warning(
      `Failed to resolve GitHub user for commit ${commit.sha}: ${getErrorMessage(error)}`,
    );
  }

  let pullRequests: PullRequestSummary[] = [];

  try {
    pullRequests = await client.listPullRequestsAssociatedWithCommit(
      owner,
      repo,
      commit.sha,
    );
  } catch (error: unknown) {
    warning(
      `Failed to resolve pull request for commit ${commit.sha}: ${getErrorMessage(error)}`,
    );
  }

  const firstPullRequest = pullRequests[0];

  let prNumber: string | undefined;
  let prTitle: string | undefined;
  let prUrl: string | undefined;
  let prUserLogin: string | undefined;

  if (firstPullRequest) {
    prNumber = String(firstPullRequest.number);
    prTitle = firstPullRequest.title;
    prUrl = firstPullRequest.html_url;
    prUserLogin = firstPullRequest.user?.login;
  } else {
    const parsedPr = parsePrReferenceFromSubject(commit.subject);

    if (parsedPr.prNumber) {
      prNumber = parsedPr.prNumber;
      prUrl = `${config.githubServerUrl}/${config.githubRepository}/pull/${parsedPr.prNumber}`;
      prTitle = parsedPr.isMergeCommit
        ? `Pull request #${parsedPr.prNumber}`
        : commit.subject;
    }
  }

  const resolvedLogin =
    commitLogin !== undefined && commitLogin !== "" ? commitLogin : prUserLogin;
  const isBot =
    commit.authorEmail.includes("[bot]") ||
    (resolvedLogin !== undefined && resolvedLogin.includes("[bot]"));
  const hasEligibleLogin =
    resolvedLogin !== undefined && resolvedLogin !== "" && !isBot;

  if (prNumber !== undefined && prUrl !== undefined) {
    if (seenPrNumbers.has(prNumber)) {
      return undefined;
    }
    seenPrNumbers.add(prNumber);

    const title =
      prTitle !== undefined && prTitle !== "" ? prTitle : commit.subject;

    return hasEligibleLogin
      ? `* ${title} by @${resolvedLogin} in [#${prNumber}](${prUrl})`
      : `* ${title} in [#${prNumber}](${prUrl})`;
  }

  return hasEligibleLogin
    ? `* ${commit.subject} by @${resolvedLogin} in [${commit.shortSha}](${commitUrl})`
    : `* ${commit.subject} by ${commit.authorName} in [${commit.shortSha}](${commitUrl})`;
}

export async function collectCommits(
  config: ActionConfig,
  setup: ReleaseSetup,
  git: GitPort,
  client: GitHubClient,
): Promise<CollectedReleaseData> {
  const repository = parseRepositoryCoordinates(config.githubRepository);
  const gitOptions: GitOptions = { cwd: config.githubWorkspace };

  if (!config.dryRun) {
    git.fetchBranchesAndTags(gitOptions);
  }

  const existingTags = git.tagList(gitOptions);
  const { prevSemverTag, nextSemverTag } = findPrevAndNextSemverTags(
    existingTags,
    setup.tag,
  );
  const commitRange = computeCommitRange(setup, prevSemverTag, nextSemverTag);

  const fullChangelogLine = prevSemverTag
    ? `**Full Changelog**: [${prevSemverTag}...${setup.tag}](${config.githubServerUrl}/${config.githubRepository}/compare/${prevSemverTag}...${setup.tag})`
    : undefined;

  const rawLog = git.gitLog(
    commitRange,
    `%H${FIELD_SEPARATOR}%h${FIELD_SEPARATOR}%an${FIELD_SEPARATOR}%ae${FIELD_SEPARATOR}%s`,
    MAX_COMMITS,
    gitOptions,
  );
  const commits = parseCommitLines(rawLog);

  if (commits.length === 0) {
    return {
      commitLogLines: ["* No changes since last release."],
      fullChangelogLine,
    };
  }

  const seenPrNumbers = new Set<string>();
  const commitLogLines: string[] = [];

  for (const commit of commits) {
    const line = await buildCommitLine(
      commit,
      config,
      repository,
      client,
      seenPrNumbers,
    );

    if (line !== undefined) {
      commitLogLines.push(line);
    }
  }

  return { commitLogLines, fullChangelogLine };
}
