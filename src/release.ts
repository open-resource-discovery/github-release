import { getOctokit, context } from "@actions/github";
import * as fs from "node:fs";

/* eslint-disable @typescript-eslint/naming-convention */
function getRequiredEnv(name: string): string {
  const value = process.env[name];

  if (value === undefined || value === "") {
    throw new Error(`${name} is required but not set.`);
  }

  return value;
}

export async function createRelease(): Promise<string> {
  const token = getRequiredEnv("GITHUB_TOKEN");
  const tag_name = getRequiredEnv("TAG");

  const octokit = getOctokit(token);
  const { owner, repo } = context.repo;

  const target_commitish = process.env.TARGET_BRANCH || "main";
  const name = process.env.RELEASE_TITLE || tag_name;
  const body = process.env.RELEASE_BODY || "";
  const draft = process.env.RELEASE_DRAFT === "true";
  const prerelease = process.env.RELEASE_PRERELEASE === "true";

  process.stdout.write(
    `Creating release for tag: ${tag_name} in ${owner}/${repo}\n`,
  );

  const release = await octokit.rest.repos.createRelease({
    owner,
    repo,
    tag_name,
    target_commitish,
    name,
    body,
    draft,
    prerelease,
  });

  const releaseUrl = release.data.html_url;

  if (releaseUrl === undefined || releaseUrl === "") {
    throw new Error("Release response is missing html_url.");
  }

  const githubOutput = process.env.GITHUB_OUTPUT;

  if (githubOutput) {
    fs.appendFileSync(githubOutput, `release-url=${releaseUrl}\n`);
  }

  return releaseUrl;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  createRelease().catch((error: unknown) => {
    const errorMessage =
      error instanceof Error ? error.message : "An unknown error occurred.";

    process.stderr.write(`Error creating release: ${errorMessage}\n`);
    process.exit(1);
  });
}
