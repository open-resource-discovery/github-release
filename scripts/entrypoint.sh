#!/bin/sh
set -e  # Stop script execution on any error

echo "Starting GitHub Action inside Docker container..."

# Run the setup process
sh /app/scripts/setup-release.sh
sh /app/scripts/collect-commits.sh
sh /app/scripts/update-changelog.sh
sh /app/scripts/create-pr.sh
sh /app/scripts/create-release.sh

echo "GitHub Action execution completed."
