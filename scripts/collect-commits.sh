#!/bin/sh
set -e  # Stop the script if any command fails

# Define variables
BASE_URL="$GITHUB_SERVER_URL"
BASE_API_URL="$GITHUB_API_URL"
REPO="$GITHUB_REPOSITORY"

git fetch origin "$TARGET_BRANCH"

# Skip commit and contributor collection if the release already exists
if [ "$RELEASE_EXISTS" = "true" ]; then
  echo "Skipping commit and contributor collection as the release already exists."
  exit 1
fi

# Fetch all git tags
git fetch --tags || { echo "::error:: Failed to fetch git tags"; return 0; }

# Sort tags by creation date
sorted_tags=$(git for-each-ref --sort=creatordate --format='%(refname:short)' refs/tags) || { echo "::error:: Failed Sort tags by creation date"; return 0; }

# Determine commit range
if [ "$TAG_EXISTS" = "true" ]; then
  previous_tag=$(echo "$sorted_tags" | grep -B1 "^$TAG$" | head -n1)
  if [ -z "$previous_tag" ]; then
    echo "No previous tag found. Collecting all commits up to $TAG."
    commit_range="$TAG"
  else
    echo "Collecting commits between $previous_tag and $TAG."
    commit_range="$previous_tag..$TAG"
  fi
else
  latest_tag=$(echo "$sorted_tags" | tail -n1)
  if [ -z "$latest_tag" ]; then
    echo "No tags found. Collecting all commits."
    commit_range="HEAD"
  else
    echo "Collecting commits since the latest tag $latest_tag to HEAD."
    commit_range="$latest_tag..HEAD"
  fi
fi

# Check if commit range is valid
if [ -z "$commit_range" ]; then
  echo "No commit range defined. Skipping commit collection."
  return 0
fi

# Collect commit log and contributors
commit_data=$(git log "$commit_range" --max-count=30 --pretty=format:"%h|%an|%ae") || { echo "::error:: commit data failed"; return 0; }
if [ -z "$commit_data" ]; then
  echo "No commits found in the specified range."   
  commit_log="* No changes since last release."
  echo "$commit_log" > commit_log.txt
  echo "<table><tr><td>No contributors found</td></tr></table>" > contributors.txt
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
echo "$commit_log" > commit_log.txt

# Prepare contributors list with profile pictures
contributor_details="<table><tr>"

for email in $commit_emails; do
  if echo "$email" | grep -q '\[bot\]'; then
    echo "::warning:: Skipping bot user: $email"
    continue
  fi

  commit_sha=$(echo "$commit_data" | grep "$email" | awk -F"|" '{print $1}' | head -n1)

  if [ -n "$commit_sha" ]; then
    echo "Debug: No user found for email $email. Trying commit lookup with SHA: $commit_sha"

    commit_response=$(curl -s -H "Authorization: Bearer $GITHUB_TOKEN" \
                            -H "Accept: application/vnd.github+json" \
                            "$BASE_API_URL/repos/$REPO/commits/$commit_sha")

    echo "Debug: GitHub API commit response for SHA $commit_sha = $commit_response"

    if echo "$commit_response" | jq empty > /dev/null 2>&1; then
      login=$(echo "$commit_response" | jq -r '.author.login // empty')
    fi
  else
    echo "Debug: No commit SHA found for email $email. Skipping commit lookup."
  fi

  # Step 3: Final check
  if [ -z "$login" ] || [ "$login" = "empty" ]; then
    echo "::warning:: No valid GitHub user found for email $email or commit lookup. Skipping..."
    continue
  fi

  # Fetch GitHub user details
  user_response=$(curl -s -H "Authorization: Bearer $GITHUB_TOKEN" \
                         -H "Accept: application/vnd.github+json" \
                         "$BASE_API_URL/users/$login")

  echo "Debug: GitHub API user response for login $login = $user_response"

  if echo "$user_response" | jq empty > /dev/null 2>&1; then
    full_name=$(echo "$user_response" | jq -r '.name // empty')
    profile_url=$(echo "$user_response" | jq -r '.html_url // empty')
    avatar_url=$(echo "$user_response" | jq -r '.avatar_url // empty')
  fi

  # If no full name is found, use the login name
  if [ -z "$full_name" ] || [ "$full_name" = "empty" ]; then
    full_name="$login"
  fi

  echo "Debug: Found user '$full_name' with profile $profile_url"

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

# Save contributors to a file
echo "$contributor_details" > contributors.txt
