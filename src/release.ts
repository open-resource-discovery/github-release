import { getOctokit, context } from "@actions/github";
import * as fs from "fs";

/* eslint-disable @typescript-eslint/naming-convention */
export async function createRelease(): Promise<string> {
  try {
    const token = process.env.GITHUB_TOKEN || "invalid-token";
    if (!token) throw new Error("GITHUB_TOKEN is required but not set.");

    const octokit = getOctokit(token);
    const { owner, repo } = context.repo;

    const tag_name = process.env.TAG;
    if (!tag_name) throw new Error("Tag name is required but not set.");

    const target_commitish = process.env.TARGET_BRANCH || "main";
    const name = process.env.RELEASE_TITLE || `${tag_name}`;
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

    const githubOutput = process.env.GITHUB_OUTPUT;
    if (githubOutput) {
      fs.appendFileSync(githubOutput, `release-url=${release.data.html_url}\n`);
    }

    return release.data.html_url;
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "An unknown error occurred.";

    process.stderr.write(`Error creating release: ${errorMessage}\n`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  createRelease().catch((error) => {
    process.stdout.write(`Unhandled error: ${error.message}`);
    process.exit(1);
  });
}
