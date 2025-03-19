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
  if [ "$DRY_RUN" = "true" ]; then
    echo "Dry-Run: Skipping 'git checkout -b $branch_name'."
  else
    git checkout -b "$branch_name" "origin/$TARGET_BRANCH"
  fi
fi

# Stage and commit local changes to avoid issues when switching branches
if [ "$DRY_RUN" = "true" ]; then
  echo "Dry-Run: Skipping 'git add' and 'git commit'."
else
  git add "$CHANGELOG_FILE_PATH"
  git commit -m "chore: update changelog for version $VERSION" || echo "No changes to commit"
fi

if [ "$DRY_RUN" = "true" ]; then
  echo "Dry-Run: Skipping 'git push origin $branch_name'."
else
  git push origin "$branch_name"
fi

# Create a pull request
pr_title="chore: update changelog for version $VERSION"
pr_body="This PR updates the changelog for the new version $VERSION. Please review and merge it to proceed with the release process."

if [ "$DRY_RUN" = "true" ]; then
  echo "Dry-Run: Skipping PR creation."
  echo "Would have sent API request with title: '$pr_title' and branch '$branch_name'."
  pr_url="https://github.com/$GITHUB_REPOSITORY/pull/dry-run-placeholder"
else
  echo "Creating PR using GitHub CLI..."
  
  if gh pr create --title "chore: update changelog for version $VERSION" \
                  --body "This PR updates the changelog for the new version $VERSION. Please review and merge." \
                  --base "$TARGET_BRANCH" --head "$branch_name" \
                  --repo "$GITHUB_REPOSITORY"; then
    echo "✅ PR successfully created using GitHub CLI."
  else
    echo "⚠️ GitHub CLI failed, falling back to GitHub API..."

    # GitHub API Request als Fallback
    response=$(curl -s -w "%{http_code}" -o response.json -X POST \
      -H "Authorization: Bearer $GITHUB_TOKEN" \
      -H "Accept: application/vnd.github+json" \
      -H "Content-Type: application/json" \
      -d "{\"title\":\"$pr_title\",\"head\":\"$branch_name\",\"base\":\"$TARGET_BRANCH\",\"body\":\"$pr_body\"}" \
      "$GITHUB_API_URL/repos/$GITHUB_REPOSITORY/pulls")

    http_status=$(tail -n1 <<< "$response")  # Extrahiere HTTP-Statuscode
    response_body=$(cat response.json)       # Lade API-Antwort in eine Variable

    echo "GitHub API Response (Status: $http_status): $response_body"

    # Fehlerbehandlung bei ungültigem JSON
    if ! echo "$response_body" | jq empty > /dev/null 2>&1; then
      echo "::error:: Invalid GitHub API response: $response_body"
      exit 1
    fi

    # Prüfe auf API-Fehlermeldung
    error_message=$(echo "$response_body" | jq -r '.message // empty')
    if [ -n "$error_message" ]; then
      echo "::error:: GitHub API Error: $error_message"

      # Spezifische Fehlerbehandlung für häufige Statuscodes
      if [ "$http_status" -eq 403 ]; then
        echo "::error:: ❌ Permission denied! Check if GITHUB_TOKEN has 'pull-requests: write' permission."
      elif [ "$http_status" -eq 422 ]; then
        echo "::error:: ⚠️ PR already exists or invalid request."
      fi

      exit 1
    fi

    # Extrahiere PR-URL
    pr_url=$(echo "$response_body" | jq -r '.html_url // empty')

    if [ -z "$pr_url" ] || [ "$pr_url" = "null" ]; then
      echo "::warning:: Failed to extract PR URL. Full API Response: $response_body"
      exit 1
    fi

    echo "✅ PR successfully created using GitHub API."
    echo "Pull Request URL: $pr_url"
  fi
fi

echo "PR_URL=$pr_url" | tee -a $GITHUB_ENV
export PR_URL="$pr_url"

cd "$GITHUB_WORKSPACE"
rm -rf "$TEMP_DIR"

# Notify the user about the created PR
echo "::notice::A pull request has been created for the changelog update."
echo "::notice::PR URL: $PR_URL"
if [ "$DRY_RUN" = "true" ]; then
  echo "Dry-Run: Skipping release process. No PR was actually created."
else
  echo "::error:: Please review and merge the PR before re-running the workflow to complete the release process."
  echo "::error:: Skipping the release process. Please re-run the workflow after merging the PR."
  exit 1
fi
