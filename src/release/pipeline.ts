import type { ActionConfig } from "../config.js";
import * as realGit from "../git/git.js";
import type { GitPort } from "../git/git.js";
import { createGitHubClient, type GitHubClient } from "../github/client.js";
import { info } from "../utils/log.js";
import {
  exportChangelogState,
  exportPrState,
  exportSetupState,
} from "./actionState.js";
import { collectCommits } from "./collectCommits.js";
import { createChangelogPr } from "./createChangelogPr.js";
import { createReleaseForTag } from "./createRelease.js";
import { setupRelease } from "./setupRelease.js";
import { updateChangelog } from "./updateChangelog.js";

export type PipelineDependencies = {
  git?: GitPort;
  client?: GitHubClient;
};

export async function runPipeline(
  config: ActionConfig,
  deps: PipelineDependencies = {},
): Promise<void> {
  info("Starting GitHub Release Action TypeScript pipeline.");

  const git = deps.git ?? realGit;
  const client =
    deps.client ??
    createGitHubClient({
      githubToken: config.githubToken,
      githubApiUrl: config.githubApiUrl,
    });

  const setup = await setupRelease(config, git, client);
  exportSetupState(setup);

  if (setup.releaseExists) {
    throw new Error(`Release for tag ${setup.tag} already exists.`);
  }

  const collected = await collectCommits(config, setup, git, client);
  const changelogResult = await updateChangelog(config, setup, collected, git);
  exportChangelogState(changelogResult.updated);

  if (changelogResult.updated) {
    const prResult = await createChangelogPr(
      config,
      setup,
      changelogResult,
      git,
      client,
    );
    exportPrState(prResult);

    if (config.dryRun) {
      info("Dry-Run: Skipping release process. No PR was actually created.");
      return;
    }

    throw new Error(
      `Please review and merge the changelog PR before re-running the workflow: ${prResult.prUrl}`,
    );
  }

  await createReleaseForTag(config, setup, changelogResult.releaseBody, client);

  info("GitHub Release Action TypeScript pipeline completed.");
}
