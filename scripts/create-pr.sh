#!/bin/sh
set -e  # Stop the script if any command fails

# Define variables
CHANGELOG_FILE_PATH="${CHANGELOG_FILE_PATH:-CHANGELOG.md}"
TEMP_DIR=$(mktemp -d)

urlencode() {
  jq -nr --arg value "$1" '$value|@uri'
}

map_job_conclusion_to_check_conclusion() {
  conclusion="$1"

  case "$conclusion" in
    success|failure|neutral|cancelled|skipped|timed_out|action_required)
      echo "$conclusion"
      ;;
    *)
      echo "failure"
      ;;
  esac
}

create_check_run() {
  sha="$1"
  check_name="$2"
  conclusion="$3"
  details_url="$4"
  summary="$5"

  check_payload=$(jq -n \
    --arg name "$check_name" \
    --arg head_sha "$sha" \
    --arg conclusion "$conclusion" \
    --arg details_url "$details_url" \
    --arg summary "$summary" \
    '{
      name: $name,
      head_sha: $head_sha,
      status: "completed",
      conclusion: $conclusion,
      output: {
        title: $name,
        summary: $summary
      }
    }
    | if $details_url == "" then . else . + {details_url: $details_url} end')

  check_response_file=$(mktemp)

  if ! check_http_code=$(curl -sS -o "$check_response_file" -w "%{http_code}" -X POST \
    -H "Authorization: Bearer $GITHUB_TOKEN" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    -d "$check_payload" \
    "$GITHUB_API_URL/repos/$GITHUB_REPOSITORY/check-runs"); then
    check_http_code="000"
  fi

  check_response=$(cat "$check_response_file" || true)
  rm -f "$check_response_file"

  if [ "$check_http_code" != "201" ]; then
    echo "::error::Failed to create check run '$check_name' for $sha (HTTP $check_http_code): $check_response"
    exit 1
  fi

  echo "Created check run '$check_name' with conclusion '$conclusion' for $sha."
}

find_dispatched_workflow_run_id() {
  workflow_file="$1"
  branch_ref="$2"
  head_sha="$3"

  encoded_branch_ref=$(urlencode "$branch_ref")
  attempt=0

  while [ "$attempt" -lt 60 ]; do
    runs_response_file=$(mktemp)

    if ! runs_http_code=$(curl -sS -o "$runs_response_file" -w "%{http_code}" \
      -H "Authorization: Bearer $GITHUB_TOKEN" \
      -H "Accept: application/vnd.github+json" \
      -H "X-GitHub-Api-Version: 2022-11-28" \
      "$GITHUB_API_URL/repos/$GITHUB_REPOSITORY/actions/workflows/$workflow_file/runs?branch=$encoded_branch_ref&event=workflow_dispatch&per_page=20"); then
      runs_http_code="000"
    fi

    runs_response=$(cat "$runs_response_file" || true)
    rm -f "$runs_response_file"

    if [ "$runs_http_code" = "200" ] && printf '%s\n' "$runs_response" | jq empty > /dev/null 2>&1; then
      run_id=$(printf '%s\n' "$runs_response" | jq -r --arg head_sha "$head_sha" '
        .workflow_runs[]?
        | select(.head_sha == $head_sha)
        | .id
      ' | head -n 1)

      if [ -n "$run_id" ] && [ "$run_id" != "null" ]; then
        echo "$run_id"
        return 0
      fi
    fi

    attempt=$((attempt + 1))
    sleep 5
  done

  return 1
}

wait_for_workflow_run_completion() {
  run_id="$1"
  attempt=0

  while [ "$attempt" -lt 120 ]; do
    run_response_file=$(mktemp)

    if ! run_http_code=$(curl -sS -o "$run_response_file" -w "%{http_code}" \
      -H "Authorization: Bearer $GITHUB_TOKEN" \
      -H "Accept: application/vnd.github+json" \
      -H "X-GitHub-Api-Version: 2022-11-28" \
      "$GITHUB_API_URL/repos/$GITHUB_REPOSITORY/actions/runs/$run_id"); then
      run_http_code="000"
    fi

    run_response=$(cat "$run_response_file" || true)
    rm -f "$run_response_file"

    if [ "$run_http_code" = "200" ] && printf '%s\n' "$run_response" | jq empty > /dev/null 2>&1; then
      run_status=$(printf '%s\n' "$run_response" | jq -r '.status // empty')
      run_conclusion=$(printf '%s\n' "$run_response" | jq -r '.conclusion // empty')

      echo "Workflow run $run_id status: $run_status conclusion: ${run_conclusion:-none}"

      if [ "$run_status" = "completed" ]; then
        return 0
      fi
    fi

    attempt=$((attempt + 1))
    sleep 10
  done

  echo "::error::Timed out waiting for workflow run $run_id to complete."
  exit 1
}

mirror_workflow_jobs_as_check_runs() {
  run_id="$1"
  head_sha="$2"

  jobs_response_file=$(mktemp)

  if ! jobs_http_code=$(curl -sS -o "$jobs_response_file" -w "%{http_code}" \
    -H "Authorization: Bearer $GITHUB_TOKEN" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "$GITHUB_API_URL/repos/$GITHUB_REPOSITORY/actions/runs/$run_id/jobs?per_page=100"); then
    jobs_http_code="000"
  fi

  jobs_response=$(cat "$jobs_response_file" || true)
  rm -f "$jobs_response_file"

  if [ "$jobs_http_code" != "200" ] || ! printf '%s\n' "$jobs_response" | jq empty > /dev/null 2>&1; then
    echo "::error::Failed to read jobs for workflow run $run_id (HTTP $jobs_http_code): $jobs_response"
    exit 1
  fi

  if ! printf '%s\n' "$jobs_response" | jq -e '.jobs | length > 0' > /dev/null 2>&1; then
    echo "::error::Workflow run $run_id has no jobs. Cannot mirror required checks."
    exit 1
  fi

  jobs_file=$(mktemp)
  tab=$(printf '\t')

  printf '%s\n' "$jobs_response" | jq -r '
    .jobs[]
    | [
        .name,
        (.conclusion // "failure"),
        (.html_url // "")
      ]
    | @tsv
  ' > "$jobs_file"

  while IFS="$tab" read -r job_name job_conclusion job_url; do
    [ -z "$job_name" ] && continue

    check_conclusion=$(map_job_conclusion_to_check_conclusion "$job_conclusion")

    create_check_run \
      "$head_sha" \
      "$job_name" \
      "$check_conclusion" \
      "$job_url" \
      "Mirrored result from dispatched workflow run $run_id."

    case "$check_conclusion" in
      success|neutral|skipped)
        ;;
      *)
        rm -f "$jobs_file"
        echo "::error::Dispatched CI job '$job_name' finished with conclusion '$job_conclusion'."
        exit 1
        ;;
    esac
  done < "$jobs_file"

  rm -f "$jobs_file"
}

get_current_release_workflow_path() {
  printf '%s\n' "$GITHUB_WORKFLOW_REF" | sed -n 's#^[^/]*/[^/]*/\(.github/workflows/[^@]*\)@.*#\1#p'
}

workflow_supports_auto_dispatch() {
  workflow_path="$1"

  workflow_content=$(grep -Ev '^[[:space:]]*#' "$workflow_path" || true)

  printf '%s\n' "$workflow_content" | grep -Eq '(^|[^_[:alnum:]-])workflow_dispatch([^_[:alnum:]-]|$)' && \
  printf '%s\n' "$workflow_content" | grep -Eq '(^|[^_[:alnum:]-])pull_request([^_[:alnum:]-]|$)'
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
  head_sha="$2"

  if [ -z "$GITHUB_TOKEN" ]; then
    echo "::error::GITHUB_TOKEN is required to dispatch CI workflows."
    exit 1
  fi

  if [ -z "$head_sha" ]; then
    echo "::error::PR head SHA is required to mirror CI checks."
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
  echo "Mirroring dispatched CI jobs as check runs for PR head SHA: $head_sha"

  while IFS= read -r workflow_file; do
    [ -z "$workflow_file" ] && continue

    echo "Dispatching workflow: $workflow_file"

    dispatch_payload=$(jq -n --arg ref "$branch_ref" '{ref: $ref}')
    dispatch_response_file=$(mktemp)

    if ! dispatch_http_code=$(curl -sS -o "$dispatch_response_file" -w "%{http_code}" -X POST \
      -H "Authorization: Bearer $GITHUB_TOKEN" \
      -H "Accept: application/vnd.github+json" \
      -H "X-GitHub-Api-Version: 2022-11-28" \
      -d "$dispatch_payload" \
      "$GITHUB_API_URL/repos/$GITHUB_REPOSITORY/actions/workflows/$workflow_file/dispatches"); then
      dispatch_http_code="000"
    fi

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

    run_id=$(find_dispatched_workflow_run_id "$workflow_file" "$branch_ref" "$head_sha") || {
      echo "::error::Could not find dispatched workflow run for '$workflow_file' on branch '$branch_ref' and SHA '$head_sha'."
      rm -f "$workflows_file"
      exit 1
    }

    echo "Found dispatched workflow run: $run_id"

    wait_for_workflow_run_completion "$run_id"
    mirror_workflow_jobs_as_check_runs "$run_id" "$head_sha"
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

branch_head_sha=$(git rev-parse HEAD)
echo "CHANGELOG_PR_HEAD_SHA=$branch_head_sha" | tee -a "$GITHUB_ENV"
export CHANGELOG_PR_HEAD_SHA="$branch_head_sha"
echo "Changelog PR head SHA: $CHANGELOG_PR_HEAD_SHA"

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
  dispatch_configured_ci_workflows "$branch_name" "$CHANGELOG_PR_HEAD_SHA"
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
