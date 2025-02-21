#!/bin/sh
set -e  # Stop the script if any command fails

# Define variables
BASE_URL="$GITHUB_SERVER_URL"
REPO="$GITHUB_REPOSITORY"

# Skip commit and contributor collection if the release already exists
if [ "$RELEASE_EXISTS" = "true" ]; then
  echo "Skipping commit and contributor collection as the release already exists."
  exit 0
fi

# Fetch all git tags
git fetch --tags || { echo "::error:: Failed to fetch git tags"; exit 0; }

# Sort tags by creation date
sorted_tags=$(git for-each-ref --sort=creatordate --format='%(refname:short)' refs/tags)

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

echo "Debug: latest_tag is '$latest_tag'"
echo "Debug: previous_tag is '$previous_tag'"
echo "Debug: commit_range before validation is '$commit_range'"

# Check if commit range is valid
if [ -z "$commit_range" ]; then
  echo "No commit range defined. Skipping commit collection."
  exit 0
fi

echo "Debug: commit_range after validation is '$commit_range'"

# Collect commit log and contributors
commit_data=$(git log "$commit_range" --max-count=30 --pretty=format:"%an|%ae") || { echo "::error:: commit data failed"; exit 0; }
if [ -z "$commit_data" ]; then
  echo "No commits found in the specified range."
  commit_log="* No changes since last release."
  echo "$commit_log" > commit_log.txt
  echo "<table><tr><td>No contributors found</td></tr></table>" > contributors.txt
  exit 0
fi

# Collect commit log
commit_log=$(git log "$commit_range" --max-count=30 --pretty=format:"* [%h]($BASE_URL/$REPO/commit/%H) %s (%an)")|| { echo "::error:: commit log failed"; exit 0; }

# Extract names and emails from commits
email_to_name="{}"
echo "$commit_data" | while IFS="|" read -r author_name author_email; do
  if [ -n "$author_name" ] && [ -n "$author_email" ]; then
    email_to_name=$(echo "$email_to_name" | jq --arg email "$author_email" --arg name "$author_name" '. + {($email): $name}')
  fi
done
# Extract unique emails
commit_emails=$(echo "$commit_data" | awk -F"|" '{print $2}' | sort | uniq)

# Save commit log to a file
echo "$commit_log" > commit_log.txt

# Prepare contributors list with profile pictures
contributor_details="<table><tr>"
for email in $commit_emails; do

  if echo "$email" | grep -q '\[bot\]'; then
    echo "::warning:: Skipping bot user: $email"
    continue
  fi

  author_name=$(echo "$email_to_name" | jq -r --arg email "$email" '.[$email] // empty')

  # Query GitHub API for user details
  if [ -z "$author_name" ]; then
    response=$(curl -s -H "Authorization: Bearer $GITHUB_TOKEN" \
                    -H "Accept: application/vnd.github+json" \
                    "$BASE_URL/api/v3/search/users?q=$email") || {
      echo "::warning:: GitHub API request failed for email $email"
      continue
    }

    login=$(echo "$response" | jq -r '.items[0].login // empty')
    profile_url=$(echo "$response" | jq -r '.items[0].html_url // empty')
    avatar_url=$(echo "$response" | jq -r '.items[0].avatar_url // empty')

    if [ -n "$login" ] && [ "$login" != "empty" ]; then
      user_response=$(curl -s -H "Authorization: Bearer $GITHUB_TOKEN" \
                      -H "Accept: application/vnd.github+json" \
                      "$BASE_URL/api/v3/users/$login") || {
        echo "::warning:: GitHub user request failed for login $login"
        continue
      }

      full_name=$(echo "$user_response" | jq -r '.name // empty')

      if [ -n "$full_name" ] && [ "$full_name" != "empty" ]; then
        author_name="$full_name"
      else
        author_name="$login"
      fi

      profile_url=$(echo "$user_response" | jq -r '.html_url // empty')
      avatar_url=$(echo "$user_response" | jq -r '.avatar_url // empty')
    else
      echo "WARNING: No GitHub user found for email $email. Skipping..."
      continue
    fi
  fi

  if [ -z "$profile_url" ] || [ -z "$avatar_url" ] || [ "$profile_url" = "empty" ] || [ "$avatar_url" = "empty" ]; then
    echo "WARNING: No valid GitHub profile for $email. Skipping..."
    continue
  fi

  # Build contributor HTML
  contributor_details="$contributor_details<td align='center'>
      <a href='$profile_url'>
        <img src='$avatar_url' alt='$author_name' width='50' height='50' style='border-radius: 50%;'><br>
        <span>$author_name</span>
      </a>
    </td>"
done

contributor_details="$contributor_details</tr></table>"

# Save contributors to a file
echo "$contributor_details" > contributors.txt
