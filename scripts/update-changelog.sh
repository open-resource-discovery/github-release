#!/bin/sh
set -e  # Stop the script if any command fails

# Load GitHub environment variables
source "$GITHUB_ENV"

# Define variables
CHANGELOG_FILE_PATH="${CHANGELOG_FILE_PATH:-CHANGELOG.md}"
VERSION_LINK="$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/releases/tag/$TAG"

# Fetch the latest changes from the target branch
git fetch origin "$TARGET_BRANCH"
git checkout "$TARGET_BRANCH"
git pull origin "$TARGET_BRANCH"

# Ensure required files exist
if [ ! -f commit_log.txt ]; then
  echo "Commit log file not found. No changes to update." > commit_log.txt
fi

if [ ! -f contributors.txt ]; then
  echo "Contributors file not found. No contributors to display." > contributors.txt
fi

commit_log=$(cat commit_log.txt || echo "")
contributors=$(cat contributors.txt || echo "")

# Check if the version already exists in the changelog
if grep -Eq "^## \\[\\[$VERSION\\]\\]" "$CHANGELOG_FILE_PATH" || \
   grep -Eq "^## \\[\\[$VERSION\\]\\(.*\\)\\]" "$CHANGELOG_FILE_PATH" || \
   grep -Eq "^## \\[$VERSION\\]" "$CHANGELOG_FILE_PATH"; then
   echo "Version $VERSION already exists in changelog.md. Extracting description."

   description=$(awk "/^## \\[\\[$VERSION\\]\\]/ {flag=1; next} \
              /^## \\[\\[$VERSION\\]\\(.*\\)\\]/ {flag=1; next} \
              /^## \\[$VERSION\\]/ {flag=1; next} \
              /^## \\[/ {flag=0} flag" "$CHANGELOG_FILE_PATH")

   if [ -z "$description" ]; then
     description="No description available for version $VERSION."
   fi

   {
     echo "$description"
     echo ""
     echo "### Commits"
     echo "$commit_log"
     echo ""
     echo "### Contributors"
     echo "$contributors"
   } > changelog_content.txt

   echo "CHANGELOG_UPDATED=false" >> "$GITHUB_ENV"
   exit 0
fi

# If the version does not exist, update the changelog
echo "Version $VERSION not found in changelog.md. Updating changelog..."

description=$(awk '/^## \[unreleased\]/{flag=1; next} /^## \[/{flag=0} flag' "$CHANGELOG_FILE_PATH")

header=$(awk '/^## \[unreleased\]/{exit} {print}' "$CHANGELOG_FILE_PATH")
rest=$(awk 'BEGIN {found_unreleased=0; found_first_version=0} \
            /^## \[unreleased\]/ {found_unreleased=1; next} \
            /^## \[/{if (found_unreleased && !found_first_version) {found_first_version=1} else if (found_first_version) {print; next} } \
            found_first_version {print}' "$CHANGELOG_FILE_PATH")

{
  echo "$header"
  echo ""
  echo "## [unreleased]"
  echo ""
  echo "## [[$VERSION]($VERSION_LINK)] - $(date +'%Y-%m-%d')"
  echo "$description"
  echo ""
  echo "$rest"
} > "$CHANGELOG_FILE_PATH"

{
  echo "$description"
  echo ""
  echo "### Commits"
  echo "$commit_log"
  echo ""
  echo "### Contributors"
  echo "$contributors"
} > changelog_content.txt

echo "CHANGELOG_UPDATED=true" >> "$GITHUB_ENV"
