#!/bin/sh
set -e  # Stop script execution on any error

echo "Starting GitHub Action inside Docker container..."

export CHANGELOG_FILE_PATH="$(printenv INPUT_CHANGELOG-FILE-PATH)"
echo "CHANGELOG_FILE_PATH=$(printenv INPUT_CHANGELOG-FILE-PATH)" | tee -a "$GITHUB_ENV"

export CUSTOM_TAG="$(printenv INPUT_CUSTOM-TAG)"
echo "CUSTOM_TAG=$(printenv INPUT_CUSTOM-TAG)" | tee -a "$GITHUB_ENV"

export FALLBACK_VERSION="$(printenv INPUT_FALLBACK-VERSION)"
echo "FALLBACK_VERSION=$(printenv INPUT_FALLBACK-VERSION)" | tee -a "$GITHUB_ENV"

export GITHUB_TOKEN="$(printenv INPUT_GITHUB-TOKEN)"
echo "GITHUB_TOKEN=$(printenv INPUT_GITHUB-TOKEN)" | tee -a "$GITHUB_ENV"

export RELEASE_DRAFT="$(printenv INPUT_RELEASE-DRAFT)"
echo "RELEASE_DRAFT=$(printenv INPUT_RELEASE-DRAFT)" | tee -a "$GITHUB_ENV"

export RELEASE_PRERELEASE="$(printenv INPUT_RELEASE-PRERELEASE)"
echo "RELEASE_PRERELEASE=$(printenv INPUT_RELEASE-PRERELEASE)" | tee -a "$GITHUB_ENV"

export RELEASE_TITLE_PREFIX="$(printenv INPUT_RELEASE-TITLE-PREFIX)"
echo "RELEASE_TITLE_PREFIX=$(printenv INPUT_RELEASE-TITLE-PREFIX)" | tee -a "$GITHUB_ENV"

# Import scripts instead of executing them with sh
echo "setup-release"
. /app/scripts/setup-release.sh
echo "collect-commits"
. /app/scripts/collect-commits.sh
echo "update-changelog"
. /app/scripts/update-changelog.sh
echo "create-pr"
. /app/scripts/create-pr.sh
echo "create-release"
. /app/scripts/create-release.sh

echo "GitHub Action execution completed."
