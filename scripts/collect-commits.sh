#!/bin/sh
set -e  # Stop the script if any command fails

# Define variables
BASE_URL="$GITHUB_SERVER_URL"
BASE_API_URL="$GITHUB_API_URL"
REPO="$GITHUB_REPOSITORY"

sync_git_state() {
  echo "Refreshing branch and tags from origin..."
  git fetch --prune origin "+refs/heads/*:refs/remotes/origin/*"
  git fetch --prune --prune-tags origin "+refs/tags/*:refs/tags/*"
}

# Refresh local refs before calculating ranges or contributors.
# This prevents stale branches/tags after force-pushes or history rewrites.
if [ "$DRY_RUN" = "true" ]; then
  echo "Dry-Run: Skipping remote sync."
else
  sync_git_state
fi

# Skip commit and contributor collection if the release already exists
if [ "$RELEASE_EXISTS" = "true" ]; then
  echo "Skipping commit and contributor collection as the release already exists."
  exit 1
fi

parsed_file=$(mktemp)

git tag --list | while IFS= read -r t; do
  ver=$(printf '%s\n' "$t" | sed -n 's/^[^0-9]*\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\).*$/\1/p')
  [ -n "$ver" ] && printf '%s %s\n' "$ver" "$t" >> "$parsed_file"
done

if ! git tag --list | grep -Fxq "$TAG"; then
  ver=$(printf '%s\n' "$TAG" | sed -n 's/^[^0-9]*\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\).*$/\1/p')
  [ -n "$ver" ] && printf '%s %s\n' "$ver" "$TAG" >> "$parsed_file"
fi

sorted_pairs=$(sort -t. -k1,1n -k2,2n -k3,3n "$parsed_file")
rm -f "$parsed_file"

sorted_tags=$(echo "$sorted_pairs" | awk '{print $2}')

prev_semver=""
next_semver=""
found=false
for t in $sorted_tags; do
  if [ "$t" = "$TAG" ]; then
    found=true
    continue
  fi
  if [ "$found" = false ]; then
    prev_semver="$t"
  elif [ -z "$next_semver" ]; then
    next_semver="$t"
    break
  fi
done

# Determine commit range
if [ "$TAG_EXISTS" = "true" ]; then
  if [ -n "$prev_semver" ]; then
    echo "Collecting commits between $prev_semver and $TAG."
    commit_range="$prev_semver..$TAG"
  else
    echo "No previous semver-like tag found. Collecting all commits up to $TAG."
    commit_range="$TAG"
  fi
else
  if [ -n "$prev_semver" ] && [ -n "$next_semver" ]; then
    echo "Collecting commits between $prev_semver and $next_semver."
    commit_range="$prev_semver..$next_semver"
  elif [ -n "$prev_semver" ]; then
    echo "Collecting commits since the latest semver-like tag $prev_semver to HEAD."
    commit_range="$prev_semver..HEAD"
  else
    echo "No semver-like tags found before $TAG. Collecting all commits."
    commit_range="HEAD"
  fi
fi

# Prepare full changelog link for GitHub release notes.
if [ -n "$prev_semver" ]; then
  full_changelog_url="$BASE_URL/$REPO/compare/$prev_semver...$TAG"
  printf '**Full Changelog**: [%s...%s](%s)\n' "$prev_semver" "$TAG" "$full_changelog_url" > full_changelog.txt
else
  : > full_changelog.txt
fi

# Check if commit range is valid
if [ -z "$commit_range" ]; then
  echo "No commit range defined. Skipping commit collection."
  return 0
fi

# Collect commit log and contributors
field_sep=$(printf '\037')
commit_data=$(git log "$commit_range" --max-count=30 --pretty=format:"%H${field_sep}%h${field_sep}%an${field_sep}%ae${field_sep}%s") || { echo "::error:: commit data failed"; return 0; }
if [ -z "$commit_data" ]; then
  echo "No commits found in the specified range."   
  commit_log="* No changes since last release."

  if [ "$DRY_RUN" = "true" ]; then
    echo "Dry-Run: Skipping writing 'commit_log.txt' and 'contributors.txt'."
  else
    echo "$commit_log" > commit_log.txt
    : > contributors.txt
  fi
  return 0
fi

# Collect commit log
# Build GitHub-native release notes with @mentions and PR links.
commit_log_file=$(mktemp)
contributors_mentions_file=$(mktemp)
seen_logins_file=$(mktemp)
seen_prs_file=$(mktemp)

printf '%s\n' "$commit_data" | while IFS="$field_sep" read -r commit_sha short_sha author_name author_email subject; do
  [ -z "$commit_sha" ] && continue

  login=""
  pr_number=""
  pr_title=""
  pr_url=""
  pr_user=""
  commit_url="$BASE_URL/$REPO/commit/$commit_sha"

  commit_response=$(curl -s -H "Authorization: Bearer $GITHUB_TOKEN" \
                          -H "Accept: application/vnd.github+json" \
                          "$BASE_API_URL/repos/$REPO/commits/$commit_sha")

  if printf '%s\n' "$commit_response" | jq empty > /dev/null 2>&1; then
    login=$(printf '%s\n' "$commit_response" | jq -r '.author.login // empty')
  fi

  pr_response=$(curl -s -H "Authorization: Bearer $GITHUB_TOKEN" \
                       -H "Accept: application/vnd.github+json" \
                       "$BASE_API_URL/repos/$REPO/commits/$commit_sha/pulls?per_page=1")

  if printf '%s\n' "$pr_response" | jq empty > /dev/null 2>&1 && \
     [ "$(printf '%s\n' "$pr_response" | jq 'length')" -gt 0 ]; then
    pr_number=$(printf '%s\n' "$pr_response" | jq -r '.[0].number // empty')
    pr_title=$(printf '%s\n' "$pr_response" | jq -r '.[0].title // empty')
    pr_url=$(printf '%s\n' "$pr_response" | jq -r '.[0].html_url // empty')
    pr_user=$(printf '%s\n' "$pr_response" | jq -r '.[0].user.login // empty')
  fi

  if [ -z "$login" ] || [ "$login" = "empty" ]; then
    login="$pr_user"
  fi

  is_bot=false
  if printf '%s\n' "$author_email" | grep -q '\[bot\]' || \
     printf '%s\n' "$login" | grep -q '\[bot\]'; then
    is_bot=true
  fi

  if [ -n "$login" ] && [ "$login" != "empty" ] && [ "$is_bot" = "false" ]; then
    if ! grep -Fxq -- "$login" "$seen_logins_file"; then
      printf '%s\n' "$login" >> "$seen_logins_file"
      printf '@%s\n' "$login" >> "$contributors_mentions_file"
    fi
  fi

  if [ -n "$pr_number" ] && [ "$pr_number" != "empty" ] && \
     [ -n "$pr_url" ] && [ "$pr_url" != "empty" ]; then
    if grep -Fxq -- "$pr_number" "$seen_prs_file"; then
      continue
    fi

    printf '%s\n' "$pr_number" >> "$seen_prs_file"

    if [ -z "$pr_title" ] || [ "$pr_title" = "empty" ]; then
      pr_title="$subject"
    fi

    if [ -n "$login" ] && [ "$login" != "empty" ] && [ "$is_bot" = "false" ]; then
      printf '* %s by @%s in [#%s](%s)\n' "$pr_title" "$login" "$pr_number" "$pr_url" >> "$commit_log_file"
    else
      printf '* %s in [#%s](%s)\n' "$pr_title" "$pr_number" "$pr_url" >> "$commit_log_file"
    fi

    continue
  fi

  if [ -n "$login" ] && [ "$login" != "empty" ] && [ "$is_bot" = "false" ]; then
    printf '* %s by @%s in [%s](%s)\n' "$subject" "$login" "$short_sha" "$commit_url" >> "$commit_log_file"
  else
    printf '* %s by %s in [%s](%s)\n' "$subject" "$author_name" "$short_sha" "$commit_url" >> "$commit_log_file"
  fi
done

commit_log=$(cat "$commit_log_file")
contributors_mentions=$(paste -sd' ' "$contributors_mentions_file")

rm -f "$commit_log_file" "$contributors_mentions_file" "$seen_logins_file" "$seen_prs_file"

if [ "$DRY_RUN" = "true" ]; then
  echo "Dry-Run: Skipping writing 'commit_log.txt' and 'contributors.txt'."
else
  echo "$commit_log" > commit_log.txt
  printf '%s\n' "$contributors_mentions" > contributors.txt
fi