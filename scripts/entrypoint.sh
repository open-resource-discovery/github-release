#!/bin/sh
set -e  # Stop script execution on any error

echo "Starting GitHub Action inside Docker container..."

echo "::group::All environment variables"
env | sort
echo "::endgroup::"

export CHANGELOG_FILE_PATH="${env[INPUT_CHANGELOG-FILE-PATH]}"
echo "CHANGELOG_FILE_PATH=${env[INPUT_CHANGELOG-FILE-PATH]}" | tee -a "$GITHUB_ENV"

export CUSTOM_TAG="${env[INPUT_CUSTOM-TAG]}"
echo "CUSTOM_TAG=${env[INPUT_CUSTOM-TAG]}" | tee -a "$GITHUB_ENV"

export FALLBACK_VERSION="${env[INPUT_FALLBACK-VERSION]}"
echo "FALLBACK_VERSION=${env[INPUT_FALLBACK-VERSION]}" | tee -a "$GITHUB_ENV"

export GITHUB_TOKEN="${env[INPUT_GITHUB-TOKEN]}"
echo "GITHUB_TOKEN=${env[INPUT_GITHUB-TOKEN]}" | tee -a "$GITHUB_ENV"

export RELEASE_DRAFT="${env[INPUT_RELEASE-DRAFT]}"
echo "RELEASE_DRAFT=${env[INPUT_RELEASE-DRAFT]}" | tee -a "$GITHUB_ENV"

export RELEASE_PRERELEASE="${env[INPUT_RELEASE-PRERELEASE]}"
echo "RELEASE_PRERELEASE=${env[INPUT_RELEASE-PRERELEASE]}" | tee -a "$GITHUB_ENV"

export RELEASE_TITLE_PREFIX="${env[INPUT_RELEASE-TITLE-PREFIX]}"
echo "RELEASE_TITLE_PREFIX=${env[INPUT_RELEASE-TITLE-PREFIX]}" | tee -a "$GITHUB_ENV"

echo "::group::All environment variables"
env | sort
echo "::endgroup::"

# Import scripts instead of executing them with sh
. /app/scripts/setup-release.sh
. /app/scripts/collect-commits.sh
. /app/scripts/update-changelog.sh
. /app/scripts/create-pr.sh
. /app/scripts/create-release.sh

echo "GitHub Action execution completed."
