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

# Check if commit range is valid
if [ -z "$commit_range" ]; then
  echo "No commit range defined. Skipping commit collection."
  return 0
fi

# Collect commit log and contributors
commit_data=$(git log "$commit_range" --max-count=30 --pretty=format:"%H|%an|%ae") || { echo "::error:: commit data failed"; return 0; }
if [ -z "$commit_data" ]; then
  echo "No commits found in the specified range."   
  commit_log="* No changes since last release."

  if [ "$DRY_RUN" = "true" ]; then
    echo "Dry-Run: Skipping writing 'commit_log.txt' and 'contributors.txt'."
  else
    echo "$commit_log" > commit_log.txt
    echo "<table><tr><td>No contributors found</td></tr></table>" > contributors.txt
  fi
  return 0
fi

# Collect commit log
commit_log=$(git log "$commit_range" --max-count=30 --pretty=format:"* [%h]($BASE_URL/$REPO/commit/%H) %s (%an)")
log_status=$?

if [ $log_status -ne 0 ]; then
  echo "::error:: git log failed with exit code $log_status"
  echo "::error:: commit_range was '$commit_range'"
  return 0
fi

# Extract unique contributor emails and commit hashes
commit_emails=$(echo "$commit_data" | awk -F"|" '{print $3}' | sort | uniq)

# Save commit log to a file
if [ "$DRY_RUN" = "true" ]; then
  echo "Dry-Run: Skipping writing 'commit_log.txt'."
else
  echo "$commit_log" > commit_log.txt
fi

# Skip contributor collection in dry-run mode
if [ "$DRY_RUN" = "true" ]; then
  echo "Dry-Run: Skipping contributor collection."
  contributor_details="<table><tr><td>Dry-Run: Contributor collection skipped</td></tr></table>"
else

  # Prepare contributors list with profile pictures
  contributor_details="<table><tr>"
  seen_logins=""
  for email in $commit_emails; do
    login=""
    full_name=""
    profile_url=""
    avatar_url=""

    if echo "$email" | grep -q '\[bot\]'; then
      echo "Skipping bot user: $email"
      continue
    fi

  commit_sha=$(echo "$commit_data" | awk -F"|" -v email="$email" '$3 == email { print $1; exit }')

  if [ -n "$commit_sha" ]; then

    commit_response=$(curl -s -H "Authorization: Bearer $GITHUB_TOKEN" \
                            -H "Accept: application/vnd.github+json" \
                            "$BASE_API_URL/repos/$REPO/commits/$commit_sha")

    if echo "$commit_response" | jq empty > /dev/null 2>&1; then
      login=$(echo "$commit_response" | jq -r '.author.login // empty')
    fi
  else
    echo "::warning:: No commit SHA found for email $email. Skipping commit lookup."
  fi

  # Step 3: Final check
  if [ -z "$login" ] || [ "$login" = "empty" ]; then
    echo "::warning:: No valid GitHub user found for email $email or commit lookup. Skipping..."
    continue
  fi

  case " $seen_logins " in
    *" $login "*)
      echo "Skipping duplicate contributor login: $login"
      continue
      ;;
  esac
  seen_logins="$seen_logins $login"

  # Fetch GitHub user details
  user_response=$(curl -s -H "Authorization: Bearer $GITHUB_TOKEN" \
                         -H "Accept: application/vnd.github+json" \
                         "$BASE_API_URL/users/$login")


  if echo "$user_response" | jq empty > /dev/null 2>&1; then
    full_name=$(echo "$user_response" | jq -r '.name // empty')
    profile_url=$(echo "$user_response" | jq -r '.html_url // empty')
    avatar_url=$(echo "$user_response" | jq -r '.avatar_url // empty')
  fi

  # If no full name is found, use the login name
  if [ -z "$full_name" ] || [ "$full_name" = "empty" ]; then
    full_name="$login"
  fi

    if [ -z "$profile_url" ] || [ -z "$avatar_url" ] || [ "$profile_url" = "empty" ] || [ "$avatar_url" = "empty" ]; then
      echo "::warning:: No valid GitHub profile for $email. Skipping..."
      continue
    fi

  # Build contributor HTML
  contributor_details="$contributor_details<td align='center'>
      <a href='$profile_url'>
        <img src='$avatar_url' alt='$full_name' width='50' height='50' style='border-radius: 50%;'><br>
        <span>$full_name</span>
      </a>
    </td>"
done

  contributor_details="$contributor_details</tr></table>"
fi

# Save contributors to a file
if [ "$DRY_RUN" = "true" ]; then
  echo "Dry-Run: Skipping writing 'contributors.txt'."
  echo "$contributor_details" > contributors.txt
else
  echo "$contributor_details" > contributors.txt
fi
