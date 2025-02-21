#!/bin/sh
set -e  # Stop the script if any command fails

# Allow Git to work inside GitHub Actions container
git config --global --add safe.directory /github/workspace

git config --global user.name "${GITHUB_ACTOR}"
git config --global user.email "${GITHUB_ACTOR}@users.noreply.github.com"

CHANGELOG_FILE_PATH="${CHANGELOG_FILE_PATH:-CHANGELOG.md}"
FALLBACK_VERSION="${FALLBACK_VERSION:-}"
CUSTOM_TAG="${CUSTOM_TAG:-}"

# Check if the changelog file exists
if [ ! -f "$CHANGELOG_FILE_PATH" ]; then
  echo "File not found: $CHANGELOG_FILE_PATH"
  echo "Creating a default changelog file..."
  echo "## [unreleased]\n\n### Added\n- Placeholder changelog" > "$CHANGELOG_FILE_PATH"
fi

# Determine the version and tag
if [ -f "package.json" ]; then
  version=$(jq -r '.version' package.json)
else
  echo "package.json not found. Using fallback version."
  version="$FALLBACK_VERSION"
fi

if [ -z "$version" ] || [ "$version" = "null" ]; then
  echo "Error: No version found in package.json and no fallback version provided."
  exit 1
fi

if [ -n "$CUSTOM_TAG" ]; then
  tag="$CUSTOM_TAG"
else
  tag="ms/$version"
fi

# Set RELEASE_TITLE
if [ -n "$RELEASE_TITLE_PREFIX" ]; then
  RELEASE_TITLE="$RELEASE_TITLE_PREFIX v$version"
else
  RELEASE_TITLE="v$version"
fi

echo "VERSION=$version" | tee -a $GITHUB_ENV
export VERSION="$version"
echo "TAG=$tag" | tee -a $GITHUB_ENV
export TAG="$tag"
echo "Version set to: $version ($tag)"
echo "RELEASE_TITLE=$RELEASE_TITLE" | tee -a $GITHUB_ENV
export RELEASE_TITLE="$RELEASE_TITLE"

# Check if the tag already exists
if git rev-parse --verify "refs/tags/$TAG" >/dev/null 2>&1 || \
   git rev-parse --verify "refs/tags/ms/$TAG" >/dev/null 2>&1; then
  echo "Tag $TAG already exists in the repository."
  echo "TAG_EXISTS=true" | tee -a $GITHUB_ENV
  export TAG_EXISTS=true
else
  echo "Tag $TAG does not exist."
  echo "TAG_EXISTS=false" | tee -a $GITHUB_ENV
  export TAG_EXISTS=false
fi

# Fetch all git tags
git fetch --tags

# Check if a release already exists for the tag
if [ "$TAG_EXISTS" = "false" ]; then
  echo "Tag $TAG does not exist. Skipping release check."
  echo "RELEASE_EXISTS=false" | tee -a $GITHUB_ENV
  export RELEASE_EXISTS=false
  exit 0
fi

release_response=$(curl -s -H "Authorization: Bearer $GITHUB_TOKEN" \
                   -H "Accept: application/vnd.github+json" \
                   "$GITHUB_API_URL/repos/$GITHUB_REPOSITORY/releases/tags/$TAG") || {
      echo "::error:: Release for tag $TAG"
      exit 1
    }

if echo "$release_response" | jq -e '.id' > /dev/null; then
  echo "Release for tag $TAG already exists."
  echo "RELEASE_EXISTS=true" | tee -a $GITHUB_ENV
  export RELEASE_EXISTS=true
  exit 1
else
  echo "No release exists for tag $TAG."
  echo "RELEASE_EXISTS=false" | tee -a $GITHUB_ENV
  export RELEASE_EXISTS=false
fi

# Detect the latest tag
latest_tag=$(git tag --list "ms/*" --sort=-version:refname | head -n 1)

# If no prefixed tags exist, fall back to non-prefixed tags
if [ -z "$latest_tag" ]; then
  echo "No ms/* tags found. Falling back to non-prefixed tags."
  latest_tag=$(git describe --tags --abbrev=0 || echo "")
fi

if [ -z "$latest_tag" ]; then
  echo "No tags found."
else
  echo "Latest tag: $latest_tag"
  echo "LATEST_TAG=$latest_tag" | tee -a $GITHUB_ENV
  export LATEST_TAG=latest_tag
fi

# Determine the target branch
if [ -n "$GITHUB_BASE_REF" ]; then
  echo "Target branch determined from GITHUB_BASE_REF: $GITHUB_BASE_REF"
  echo "TARGET_BRANCH=$GITHUB_BASE_REF" | tee -a $GITHUB_ENV
  export TARGET_BRANCH=GITHUB_BASE_REF
elif [ -n "$GITHUB_REF_NAME" ]; then
  echo "Target branch determined from GITHUB_REF_NAME: $GITHUB_REF_NAME"
  echo "TARGET_BRANCH=$GITHUB_REF_NAME" | tee -a $GITHUB_ENV
  export TARGET_BRANCH=GITHUB_REF_NAME
else
  echo "No target branch found. Falling back to default branch: main"
  echo "TARGET_BRANCH=main" | tee -a $GITHUB_ENV
  export TARGET_BRANCH=main
fi
