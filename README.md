[![REUSE status](https://api.reuse.software/badge/github.com/open-resource-discovery/github-release)](https://api.reuse.software/info/github.com/open-resource-discovery/github-release)

# GitHub Release Action

Automates GitHub release creation and changelog updates, generating detailed release notes with commits and contributors dynamically.

## Features

- Automatically extracts the latest version from `package.json`.
- Creates a changelog entry for each release.
- Dynamically lists commits made **after the last tag** and up to the **current commit head**.
- Generates a list of contributors for the release, linking to their profiles.
- Adds an "unreleased" section to the changelog for future updates.
- Supports draft and pre-release options for releases.

## Requirements and Setup

The GitHub token provided must have the necessary scope (`repo` for private repositories).

### Workflow Configuration Example

Add the following configuration to your GitHub Actions workflow:

```yaml
name: "Release Workflow"

on:
  workflow_dispatch:

jobs:
  create-release:
    runs-on: ubuntu-latest
    steps:
      - name: Check out repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Create GitHub Release
        uses: open-resource-discovery/github-release@main
```

## Post-Release Steps

To avoid conflicts or outdated information in your local changelog:

1. Run `git pull` in your local repository to fetch the latest changes.
2. Verify that the updated `CHANGELOG.md` file is synchronized with your local branch.

```bash
git pull
```

## Support, Feedback, Contributing

This project is open to feature requests/suggestions, bug reports etc. via [GitHub issues](https://github.com/open-resource-discovery/github-release/issues). Contribution and feedback are encouraged and always welcome. For more information about how to contribute, the project structure, as well as additional contribution information, see our [Contribution Guidelines](CONTRIBUTING.md).

## Code of Conduct

We as members, contributors, and leaders pledge to make participation in our community a harassment-free experience for everyone. By participating in this project, you agree to abide by its [Code of Conduct](https://github.com/open-resource-discovery/.github/blob/main/CODE_OF_CONDUCT.md) at all times.

## Licensing

Copyright 2025 SAP SE or an SAP affiliate company and github-release contributors. Please see our [LICENSE](LICENSE) for copyright and license information. Detailed information including third-party components and their licensing/copyright information is available [via the REUSE tool](https://api.reuse.software/info/github.com/open-resource-discovery/github-release).
