import * as fs from "node:fs";
import type { ActionConfig } from "../config.js";
import type { GitHubClient } from "../github/client.js";
import { info } from "../utils/log.js";
import { parseRepositoryCoordinates } from "../utils/repository.js";
import type { ReleaseSetup } from "./setupRelease.js";

export async function createReleaseForTag(
  config: ActionConfig,
  setup: ReleaseSetup,
  releaseBody: string,
  client: GitHubClient,
): Promise<string> {
  if (setup.tag === "") {
    throw new Error("TAG is required but not set.");
  }

  const { owner, repo } = parseRepositoryCoordinates(config.githubRepository);

  info(`Creating release for tag: ${setup.tag} in ${owner}/${repo}`);

  const release = await client.createRelease({
    owner,
    repo,
    tag_name: setup.tag,
    target_commitish: setup.targetBranch,
    name: setup.releaseTitle,
    body: releaseBody,
    draft: config.releaseDraft,
    prerelease: config.releasePrerelease,
  });

  const githubOutput = process.env.GITHUB_OUTPUT;

  if (githubOutput !== undefined && githubOutput !== "") {
    fs.appendFileSync(githubOutput, `release-url=${release.html_url}\n`);
  }

  return release.html_url;
}
