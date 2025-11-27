#!/bin/sh
set -e  # Stop the script if any command fails

# Allow Git to work inside GitHub Actions container
git config --global --add safe.directory /github/workspace

git config --global user.name "${GITHUB_ACTOR}"
git config --global user.email "${GITHUB_ACTOR}@users.noreply.github.com"

# Configure Git to use GITHUB_TOKEN for HTTPS fetches
if [ -n "$GITHUB_TOKEN" ] && [ -n "$GITHUB_SERVER_URL" ]; then
  GIT_HOST="${GITHUB_SERVER_URL#https://}"
  git config --global url."https://x-access-token:${GITHUB_TOKEN}@${GIT_HOST}/".insteadOf "https://${GIT_HOST}/"
fi

CHANGELOG_FILE_PATH="${CHANGELOG_FILE_PATH:-CHANGELOG.md}"
TAG_TEMPLATE="${TAG_TEMPLATE:-}"

# Check if the changelog file exists
if [ ! -f "$CHANGELOG_FILE_PATH" ]; then
  echo "File not found: $CHANGELOG_FILE_PATH"
  echo "Creating a default changelog file..."
  if [ "$DRY_RUN" = "true" ]; then
    echo "Dry-Run: Skipping file creation."
  else
    echo "## [unreleased]\n\n### Added\n- Placeholder changelog" > "$CHANGELOG_FILE_PATH"
  fi
fi

# Determine the version and tag
if [ -n "$VERSION_OVERRIDE" ]; then
  version="$VERSION_OVERRIDE"
  echo "Using custom version override: $version"
elif [ -f "package.json" ]; then
  version=$(jq -r '.version' package.json)
fi

if [ -z "$version" ] || [ "$version" = "null" ]; then
  echo "Error: Mandatory "version" parameter has not been specified. Please check GitHub Action configuration."
  exit 1
fi

# Determine tag based on priority
if [ -n "$TAG_TEMPLATE" ]; then
  tag=$(echo "$TAG_TEMPLATE" | sed "s/<version>/$version/")  # Use configured template
  echo "Using tag from template: $tag"
else
  tag="v$version"
  echo "No tag template provided. Using default: $tag"
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
if [ "$DRY_RUN" = "true" ]; then
  echo "Dry-Run: Skipping 'git fetch --tags'."
else
  git fetch --tags
fi

# Check if a release already exists for the tag
if [ "$TAG_EXISTS" = "false" ]; then
  echo "Tag $TAG does not exist. Skipping release check."
  echo "RELEASE_EXISTS=false" | tee -a $GITHUB_ENV
  export RELEASE_EXISTS=false
fi

release_response=$(curl -s -H "Authorization: Bearer $GITHUB_TOKEN" \
                   -H "Accept: application/vnd.github+json" \
                   "$GITHUB_API_URL/repos/$GITHUB_REPOSITORY/releases/tags/$TAG") || {
      echo "::error:: Release api call for tag $TAG failed"
      exit 1
    }

if echo "$release_response" | jq -e '.id' > /dev/null; then
  echo "Release for tag $TAG already exists."
  echo "RELEASE_EXISTS=true" | tee -a $GITHUB_ENV
  export RELEASE_EXISTS=true
  if [ "$DRY_RUN" = "true" ]; then
    echo "Dry-Run: Skipping early exit if release exists."
  else
    exit 1
  fi
else
  echo "No release exists for tag $TAG."
  echo "RELEASE_EXISTS=false" | tee -a $GITHUB_ENV
  export RELEASE_EXISTS=false
fi

if [ -n "$TAG_TEMPLATE" ]; then
   # Remove <version> from the template and search for existing tags with this pattern
  latest_tag=$(git tag --list --sort=-version:refname | grep -E "$(echo "$TAG_TEMPLATE" | sed 's/<version>//')" | head -n 1)
  
  if [ -n "$latest_tag" ]; then
    echo "Detected latest tag matching template: $latest_tag"
  else
    echo "No matching tags found for template. Using default versioning."
    latest_tag=""
  fi
else
  # Standard fallback: No more automatic detection
  latest_tag=""
  echo "No tag template provided. Skipping automatic tag detection."
fi

if [ -z "$latest_tag" ]; then
  echo "No tags found."
else
  echo "Latest tag: $latest_tag"
  echo "LATEST_TAG=$latest_tag" | tee -a $GITHUB_ENV
  export LATEST_TAG=$latest_tag
fi

# Determine the target branch
if [ -n "$GITHUB_BASE_REF" ]; then
  echo "Target branch determined from GITHUB_BASE_REF: $GITHUB_BASE_REF"
  echo "TARGET_BRANCH=$GITHUB_BASE_REF" | tee -a $GITHUB_ENV
  export TARGET_BRANCH=$GITHUB_BASE_REF
elif [ -n "$GITHUB_REF_NAME" ]; then
  echo "Target branch determined from GITHUB_REF_NAME: $GITHUB_REF_NAME"
  echo "TARGET_BRANCH=$GITHUB_REF_NAME" | tee -a $GITHUB_ENV
  export TARGET_BRANCH=$GITHUB_REF_NAME
else
  echo "No target branch found. Falling back to default branch: main"
  echo "TARGET_BRANCH=main" | tee -a $GITHUB_ENV
  export TARGET_BRANCH=main
fi
