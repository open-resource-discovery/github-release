export const FALLBACK_DESCRIPTION = "This release includes the changes below.";

export function renderReleaseBody(
  description: string,
  commitLogLines: string[],
  fullChangelogLine?: string,
): string {
  const lines = [
    "### What's new?",
    description,
    "",
    "------",
    "",
    "## What's Changed",
    commitLogLines.join("\n"),
  ];

  if (fullChangelogLine !== undefined && fullChangelogLine !== "") {
    lines.push("", fullChangelogLine);
  }

  return lines.join("\n");
}
