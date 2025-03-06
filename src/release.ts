import { getOctokit, context } from "@actions/github";
import * as fs from "fs";
import { execSync } from "child_process";

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
    const name = (process.env.RELEASE_TITLE || `${tag_name}`).trim();
    const body = process.env.RELEASE_BODY || "";
    const draft = process.env.RELEASE_DRAFT === "true";
    const prerelease = process.env.RELEASE_PRERELEASE === "true";

    const actor = process.env.GITHUB_ACTOR || "unknown-actor"; // Force actor

    process.stdout.write(
      `Creating release for tag: ${tag_name} in ${owner}/${repo}\n`,
    );

    // Push a signed commit/tag with the GITHUB_ACTOR before creating the release
    pushTagWithActor(tag_name, actor);

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

    await octokit.rest.repos.updateRelease({
      owner,
      repo,
      release_id: release.data.id,
      name,
      body,
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

// Function to push a tag using the GitHub Actor
function pushTagWithActor(tag: string, actor: string): void {
  execSync(
    `
    git config --global user.name "${actor}"
    git config --global user.email "${actor}@users.noreply.github.com"
    git tag -a ${tag} -m "Release ${tag} by ${actor}"
    git push origin ${tag}
  `,
    { stdio: "inherit" },
  );

  process.stdout.write(`Tag ${tag} pushed by ${actor}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  createRelease().catch((error) => {
    process.stdout.write(`Unhandled error: ${error.message}`);
    process.exit(1);
  });
}
