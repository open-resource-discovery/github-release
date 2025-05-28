#!/bin/sh
set -e  # Stop script execution on any error

echo "Starting GitHub Action inside Docker container..."

export DRY_RUN="$(printenv INPUT_DRY-RUN)"
echo "DRY_RUN=$(printenv INPUT_DRY-RUN)" | tee -a "$GITHUB_ENV"

export CHANGELOG_FILE_PATH="$(printenv INPUT_CHANGELOG-FILE-PATH)"
echo "CHANGELOG_FILE_PATH=$(printenv INPUT_CHANGELOG-FILE-PATH)" | tee -a "$GITHUB_ENV"

export TAG_TEMPLATE="$(printenv INPUT_TAG-TEMPLATE)"
echo "TAG_TEMPLATE=$TAG_TEMPLATE" | tee -a "$GITHUB_ENV"

export GITHUB_TOKEN="$(printenv INPUT_GITHUB-TOKEN)"
echo "GITHUB_TOKEN=$(printenv INPUT_GITHUB-TOKEN)" | tee -a "$GITHUB_ENV"

export RELEASE_DRAFT="$(printenv INPUT_RELEASE-DRAFT)"
echo "RELEASE_DRAFT=$(printenv INPUT_RELEASE-DRAFT)" | tee -a "$GITHUB_ENV"

export RELEASE_PRERELEASE="$(printenv INPUT_RELEASE-PRERELEASE)"
echo "RELEASE_PRERELEASE=$(printenv INPUT_RELEASE-PRERELEASE)" | tee -a "$GITHUB_ENV"

export RELEASE_TITLE_PREFIX="$(printenv INPUT_RELEASE-TITLE-PREFIX)"
echo "RELEASE_TITLE_PREFIX=$(printenv INPUT_RELEASE-TITLE-PREFIX)" | tee -a "$GITHUB_ENV"

export VERSION_OVERRIDE="$(printenv INPUT_VERSION)"
echo "VERSION_OVERRIDE=$VERSION_OVERRIDE" | tee -a "$GITHUB_ENV"

# Import scripts instead of executing them with sh
. /app/scripts/setup-release.sh
. /app/scripts/collect-commits.sh
. /app/scripts/update-changelog.sh
. /app/scripts/create-pr.sh
. /app/scripts/create-release.sh

echo "GitHub Action execution completed."
