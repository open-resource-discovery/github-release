#!/bin/sh
set -e  # Stop the script if any command fails

if [ "$RELEASE_EXISTS" = "true" ] || [ "$CHANGELOG_UPDATED" = "true" ]; then
  echo "Skipping release creation as either the release already exists or the changelog has been updated."
  return 0
fi

if [ -z "$TAG" ]; then
  echo "::error::TAG variable is not set. Cannot create release."
  exit 1
fi

echo "Creating or updating release for tag: $TAG"

# Run the Node.js release script
if [ "$DRY_RUN" = "true" ]; then
  echo "Dry-Run: Skipping execution of 'node /app/dist/src/release.js'."
  echo "Would have executed with:"
  echo "  env TAG=\"$TAG\" TARGET_BRANCH=\"$TARGET_BRANCH\" RELEASE_TITLE=\"$RELEASE_TITLE\" \\"
  echo "  RELEASE_BODY=\"$(cat changelog_content.txt)\" RELEASE_DRAFT=\"$RELEASE_DRAFT\" \\"
  echo "  RELEASE_PRERELEASE=\"$RELEASE_PRERELEASE\" node /app/dist/src/release.js"
else
  # Run the Node.js release script
  env TAG="$TAG" TARGET_BRANCH="$TARGET_BRANCH" RELEASE_TITLE="$RELEASE_TITLE" \
      RELEASE_BODY="$(cat changelog_content.txt)" RELEASE_DRAFT="$RELEASE_DRAFT" \
      RELEASE_PRERELEASE="$RELEASE_PRERELEASE" node /app/dist/src/release.js
fi
    
echo "Release process completed."

# Notify consumers about the new release
echo "The release is completed, and the repository has been updated."
echo "Please execute the following command in your local repository to fetch the latest changes:"
echo ""
echo "  git pull origin $TARGET_BRANCH"
echo ""
