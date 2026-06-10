#!/bin/sh
set -e  # Stop the script if any command fails

# Define variables
CHANGELOG_FILE_PATH="${CHANGELOG_FILE_PATH:-CHANGELOG.md}"
TEMP_DIR=$(mktemp -d)

dispatch_configured_ci_workflows() {
  branch_ref="$1"

  if [ -z "$CI_WORKFLOWS" ]; then
    echo "No CI workflows configured for dispatch."
    return 0
  fi

  if [ -z "$GITHUB_TOKEN" ]; then
    echo "::error::GITHUB_TOKEN is required to dispatch CI workflows."
    exit 1
  fi

  echo "Dispatching configured CI workflows for branch: $branch_ref"

  old_ifs="$IFS"
  IFS=","

  for workflow_file in $CI_WORKFLOWS; do
    workflow_file=$(printf '%s' "$workflow_file" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')

    if [ -z "$workflow_file" ]; then
      continue
    fi

    echo "Dispatching workflow: $workflow_file"

    dispatch_payload=$(jq -n --arg ref "$branch_ref" '{ref: $ref}')
    dispatch_response_file=$(mktemp)

    dispatch_http_code=$(curl -sS -o "$dispatch_response_file" -w "%{http_code}" -X POST \
      -H "Authorization: Bearer $GITHUB_TOKEN" \
      -H "Accept: application/vnd.github+json" \
      -H "X-GitHub-Api-Version: 2022-11-28" \
      -d "$dispatch_payload" \
      "$GITHUB_API_URL/repos/$GITHUB_REPOSITORY/actions/workflows/$workflow_file/dispatches" || true)

    dispatch_response=$(cat "$dispatch_response_file" || true)
    rm -f "$dispatch_response_file"

    case "$dispatch_http_code" in
      200|201|202|204)
        echo "Workflow dispatched successfully: $workflow_file"
        ;;
      *)
        echo "::error::Failed to dispatch workflow '$workflow_file' for branch '$branch_ref' (HTTP $dispatch_http_code): $dispatch_response"
        IFS="$old_ifs"
        exit 1
        ;;
    esac
  done

  IFS="$old_ifs"
}

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
  response_file=$(mktemp)
  http_code=$(curl -sS -o "$response_file" -w "%{http_code}" -X POST \
    -H "Authorization: Bearer $GITHUB_TOKEN" \
    -H "Accept: application/vnd.github+json" \
    -d "{\"title\":\"$pr_title\",\"head\":\"$branch_name\",\"base\":\"$TARGET_BRANCH\",\"body\":\"$pr_body\"}" \
    "$GITHUB_API_URL/repos/$GITHUB_REPOSITORY/pulls")

  response=$(cat "$response_file")
  rm -f "$response_file"

  if [ "$http_code" != "201" ]; then
    echo "::error:: PR creation failed (HTTP $http_code): $response"
    exit 1
  fi

  pr_url=$(echo "$response" | jq -r '.html_url // empty')

  if [ -z "$pr_url" ] || [ "$pr_url" = "null" ]; then
    echo "::error:: PR was created but html_url is missing: $response"
    exit 1
  fi
fi

echo "PR_URL=$pr_url" | tee -a $GITHUB_ENV
export PR_URL="$pr_url"

cd "$GITHUB_WORKSPACE"
rm -rf "$TEMP_DIR"

if [ "$DRY_RUN" = "true" ]; then
  echo "Dry-Run: Skipping CI workflow dispatch."
else
  dispatch_configured_ci_workflows "$branch_name"
fi

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
