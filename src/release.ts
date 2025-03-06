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
    const name = ` ${process.env.RELEASE_TITLE || tag_name} `; // Leerzeichen vorne und hinten
    const body = process.env.RELEASE_BODY || "";
    const draft = process.env.RELEASE_DRAFT === "true";
    const prerelease = process.env.RELEASE_PRERELEASE === "true";
    const actor = process.env.GITHUB_ACTOR || "unknown-actor";

    process.stdout.write(`📌 Creating a temporary PR as ${actor}...\n`);

    // 🚀 Schritt 1: Erstelle einen neuen temporären Branch & PR
    const pr = await octokit.rest.pulls.create({
      owner,
      repo,
      title: `Temporary PR for release ${tag_name}`,
      head: target_commitish,
      base: "main",
      body: "This PR is used to trigger a release and will be closed automatically.",
    });

    process.stdout.write(`✅ PR #${pr.data.number} created.\n`);

    // 🚀 Schritt 2: Füge einen Kommentar hinzu (um sicherzustellen, dass der Actor aktiv ist)
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: pr.data.number,
      body: `@${actor} is triggering this release.`,
    });

    // 🚀 Schritt 3: Erstelle das Tag aus dem PR-Branch
    await octokit.rest.git.createRef({
      owner,
      repo,
      ref: `refs/tags/${tag_name}`,
      sha: pr.data.head.sha, // Nutzt den letzten Commit des PRs
    });

    process.stdout.write(`🏷️ Tag ${tag_name} created from PR.\n`);

    // 🚀 Schritt 4: Erstelle das Release
    const release = await octokit.rest.repos.createRelease({
      owner,
      repo,
      tag_name,
      target_commitish: pr.data.head.ref,
      name,
      body,
      draft,
      prerelease,
    });

    process.stdout.write(`✅ Release created: ${release.data.html_url}\n`);

    // 🚀 Schritt 5: PR automatisch schließen
    await octokit.rest.pulls.update({
      owner,
      repo,
      pull_number: pr.data.number,
      state: "closed",
    });

    process.stdout.write(`❌ Temporary PR #${pr.data.number} closed.\n`);

    const githubOutput = process.env.GITHUB_OUTPUT;
    if (githubOutput) {
      fs.appendFileSync(githubOutput, `release-url=${release.data.html_url}\n`);
    }

    return release.data.html_url;
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "An unknown error occurred.";

    process.stderr.write(`❌ Error creating release: ${errorMessage}\n`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  createRelease().catch((error) => {
    process.stdout.write(`Unhandled error: ${error.message}`);
    process.exit(1);
  });
}
