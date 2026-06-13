#!/bin/sh
set -e  # Stop the script if any command fails

# Define variables
CHANGELOG_FILE_PATH="${CHANGELOG_FILE_PATH:-CHANGELOG.md}"
TEMP_DIR=$(mktemp -d)

get_current_release_workflow_path() {
  printf '%s\n' "$GITHUB_WORKFLOW_REF" | sed -n 's#^[^/]*/[^/]*/\(.github/workflows/[^@]*\)@.*#\1#p'
}

workflow_supports_auto_dispatch() {
  workflow_path="$1"

  workflow_content=$(grep -Ev '^[[:space:]]*#' "$workflow_path" || true)

  printf '%s\n' "$workflow_content" | grep -Eq 'workflow_dispatch' && \
  printf '%s\n' "$workflow_content" | grep -Eq 'pull_request'
}

resolve_ci_workflows() {
  if [ -z "$CI_WORKFLOWS" ] || [ "$CI_WORKFLOWS" = "auto" ]; then
    current_release_workflow_path="$(get_current_release_workflow_path)"

    for workflow_path in .github/workflows/*.yml .github/workflows/*.yaml; do
      [ -f "$workflow_path" ] || continue

      if [ -n "$current_release_workflow_path" ] && [ "$workflow_path" = "$current_release_workflow_path" ]; then
        echo "Skipping release workflow itself: $workflow_path" >&2
        continue
      fi

      if workflow_supports_auto_dispatch "$workflow_path"; then
        basename "$workflow_path"
      fi
    done | sort -u

    return 0
  fi

  if [ "$CI_WORKFLOWS" = "none" ] || [ "$CI_WORKFLOWS" = "false" ]; then
    return 0
  fi

  printf '%s' "$CI_WORKFLOWS" \
    | tr ',' '\n' \
    | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' \
    | sed '/^$/d' \
    | while IFS= read -r workflow_file; do
        basename "$workflow_file"
      done \
    | sort -u
}

dispatch_configured_ci_workflows() {
  branch_ref="$1"

  if [ -z "$GITHUB_TOKEN" ]; then
    echo "::error::GITHUB_TOKEN is required to dispatch CI workflows."
    exit 1
  fi

  workflows_file=$(mktemp)
  resolve_ci_workflows > "$workflows_file"

  if [ ! -s "$workflows_file" ]; then
    echo "No CI workflows configured or discovered for dispatch."
    rm -f "$workflows_file"
    return 0
  fi

  echo "Dispatching CI workflows for branch: $branch_ref"

  while IFS= read -r workflow_file; do
    [ -z "$workflow_file" ] && continue

    echo "Dispatching workflow: $workflow_file"

    dispatch_payload=$(jq -n --arg ref "$branch_ref" '{ref: $ref}')
    dispatch_response_file=$(mktemp)

    dispatch_http_code=$(curl -sS -o "$dispatch_response_file" -w "%{http_code}" -X POST \
      -H "Authorization: Bearer $GITHUB_TOKEN" \
      -H "Accept: application/vnd.github+json" \
      -H "X-GitHub-Api-Version: 2022-11-28" \
      -d "$dispatch_payload" \
      "$GITHUB_API_URL/repos/$GITHUB_REPOSITORY/actions/workflows/$workflow_file/dispatches" || printf "000")

    dispatch_response=$(cat "$dispatch_response_file" || true)
    rm -f "$dispatch_response_file"

    case "$dispatch_http_code" in
      200|201|202|204)
        echo "Workflow dispatched successfully: $workflow_file"
        ;;
      *)
        echo "::error::Failed to dispatch workflow '$workflow_file' for branch '$branch_ref' (HTTP $dispatch_http_code): $dispatch_response"
        rm -f "$workflows_file"
        exit 1
        ;;
    esac
  done < "$workflows_file"

  rm -f "$workflows_file"
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

if [ "$DRY_RUN" = "true" ]; then
  echo "Dry-Run: Skipping CI workflow dispatch."
else
  dispatch_configured_ci_workflows "$branch_name"
fi

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
