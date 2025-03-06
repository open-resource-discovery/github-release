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

    process.stdout.write(`Creating issue to switch context to ${actor}\n`);

    // 🚀 Workaround: Erstelle einen Issue, um den `GITHUB_ACTOR` zu aktivieren
    const issue = await octokit.rest.issues.create({
      owner,
      repo,
      title: "Temporary Issue to Set Release Creator",
      body: "This issue is created to switch context to the correct actor.",
    });

    // Warte kurz, um sicherzustellen, dass der Issue erfasst wurde
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // 🚀 Schließe den Issue wieder als `GITHUB_ACTOR`
    await octokit.rest.issues.update({
      owner,
      repo,
      issue_number: issue.data.number,
      state: "closed",
    });

    process.stdout.write(
      `Issue #${issue.data.number} closed by ${actor}. Proceeding with release.\n`,
    );

    // 🚀 Jetzt erstelle das Release
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
