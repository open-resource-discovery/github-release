#!/bin/sh
set -e  # Stop script execution on any error

echo "Starting GitHub Action inside Docker container..."

echo "::group::All environment variables"
env | sort
echo "::endgroup::"

# Export all INPUT_ variables as environment variables, replacing "-" with "_"
for var in $(env | grep '^INPUT_' | sed 's/=.*//'); do
  new_var=$(echo "$var" | sed 's/^INPUT_//' | tr '-' '_')

  echo "$new_var=${!var}" | tee -a "$GITHUB_ENV"
  export "$new_var=${!var}"
done


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
