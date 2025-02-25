#!/bin/sh
set -e  # Stop the script if any command fails

# Define variables
CHANGELOG_FILE_PATH="${CHANGELOG_FILE_PATH:-CHANGELOG.md}"
TEMP_DIR=$(mktemp -d)

if [ "$CHANGELOG_UPDATED" != "true" ]; then
  echo "Changelog was not updated. Skipping branch creation and pull request."
  return 0
fi

branch_name="release-changelog-update/${VERSION}"
echo "Cloning workspace to temporary directory: $TEMP_DIR"
cp -r "$GITHUB_WORKSPACE/." "$TEMP_DIR/"
cd "$TEMP_DIR" || exit 1

git fetch origin "$TARGET_BRANCH"

if git ls-remote --exit-code --heads origin "$branch_name"; then
  git checkout "$branch_name"
  git pull --rebase origin "$branch_name" || echo "No updates to rebase."
else
  echo "Creating new branch: $branch_name"
  git checkout -b "$branch_name" "origin/$TARGET_BRANCH"
fi

# Stage and commit local changes to avoid issues when switching branches
git add "$CHANGELOG_FILE_PATH"
git commit -m "chore: update changelog for version $VERSION" || echo "No changes to commit"

git push origin "$branch_name"

# Create a pull request
pr_title="chore: update changelog for version $VERSION"
pr_body="This PR updates the changelog for the new version $VERSION. Please review and merge it to proceed with the release process."

response=$(curl -s -X POST \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -d "{\"title\":\"$pr_title\",\"head\":\"$branch_name\",\"base\":\"$TARGET_BRANCH\",\"body\":\"$pr_body\"}" \
  "$GITHUB_API_URL/repos/$GITHUB_REPOSITORY/pulls")

if ! echo "$response" | jq empty > /dev/null 2>&1; then
  echo "::error:: Invalid GitHub API response: $response"
  exit 1
fi

pr_url=$(echo "$response" | jq -r '.html_url // empty')

if [ -z "$pr_url" ] || [ "$pr_url" = "null" ]; then
  echo "::warning::Failed to extract PR URL. Check API response."
fi

echo "PR_URL=$pr_url" | tee -a $GITHUB_ENV
export PR_URL="$pr_url"

cd "$GITHUB_WORKSPACE"
rm -rf "$TEMP_DIR"

# Notify the user about the created PR
echo "::notice::A pull request has been created for the changelog update."
echo "::notice::PR URL: $PR_URL"
echo "::error::Please review and merge the PR before re-running the workflow to complete the release process."

# Skip the release process if the PR is pending
echo "::notice::The changelog has been updated, and a PR has been created."
echo "::error::Skipping the release process. Please re-run the workflow after merging the PR."
exit 1
