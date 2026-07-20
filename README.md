[![REUSE status](https://api.reuse.software/badge/github.com/open-resource-discovery/github-release)](https://api.reuse.software/info/github.com/open-resource-discovery/github-release)

# GitHub Release Action

Automates GitHub release creation and changelog updates, generating detailed release notes with commits and contributors dynamically.

## Why this action?

Most release actions require a Personal Access Token (PAT) to open pull requests and trigger CI on protected branches. This action works entirely with the built-in `GITHUB_TOKEN` - no PAT, no extra secret management.

## Features

- Automatically extracts the latest version from `package.json`.
- Creates a changelog entry for each release.
- Dynamically lists commits made **after the last tag** and up to the **current commit head**.
- Generates a list of contributors for the release, linking to their profiles.
- Adds an "unreleased" section to the changelog for future updates.
- Supports draft and pre-release options for releases.

## Requirements and Setup

The workflow must grant the required permissions to the built-in `GITHUB_TOKEN`. No Personal Access Token is required.

### Required Permissions

The action requires the following GitHub Actions permissions:

| Permission             | Reason                                                       |
| ---------------------- | ------------------------------------------------------------ |
| `contents: write`      | Push changelog branch, create tags and releases              |
| `pull-requests: write` | Open the changelog PR                                        |
| `actions: write`       | Dispatch CI workflows for the changelog PR                   |
| `checks: write`        | Mirror CI job results as Check Runs on the changelog PR      |
| `statuses: write`      | Mirror CI job results as Commit Statuses on the changelog PR |

> **Note:** `actions: write`, `checks: write`, and `statuses: write` are only needed when
> `ci-workflows` is not set to `none` or `false`. If you disable CI dispatch, only
> `contents: write` and `pull-requests: write` are required.

### Workflow Configuration Example

Add the following configuration to your GitHub Actions workflow:

```yaml
name: "Release Workflow"

on:
  workflow_dispatch:

permissions:
  contents: write
  pull-requests: write
  actions: write
  checks: write
  statuses: write

jobs:
  create-release:
    runs-on: ubuntu-latest
    steps:
      - name: Check out repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: open-resource-discovery/github-release@main
```

## Inputs

| Input                  | Default               | Description                                                                                                                                                                                                                                    |
| ---------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `github-token`         | `${{ github.token }}` | GitHub token for authentication. The built-in token is sufficient - no PAT needed.                                                                                                                                                             |
| `tag-template`         | `v<version>`          | Tag name template. Use `<version>` as placeholder, e.g. `ms/<version>`.                                                                                                                                                                        |
| `changelog-file-path`  | `CHANGELOG.md`        | Path to the changelog file.                                                                                                                                                                                                                    |
| `version`              | _(from package.json)_ | Explicit version override. Takes precedence over `package.json`.                                                                                                                                                                               |
| `ci-workflows`         | `auto`                | Workflows to dispatch after the changelog PR is created. `auto` dispatches all `workflow_dispatch`-enabled workflows (except the release workflow itself). Pass a comma-separated list to target specific files, or `none`/`false` to disable. |
| `release-draft`        | `false`               | Mark the release as a draft.                                                                                                                                                                                                                   |
| `release-prerelease`   | `false`               | Mark the release as a prerelease.                                                                                                                                                                                                              |
| `release-title-prefix` | _(empty)_             | Prefix prepended to the release title.                                                                                                                                                                                                         |
| `dry-run`              | `false`               | Run without creating tags, PRs, or releases. Useful for testing.                                                                                                                                                                               |

## Outputs

| Output        | Description                        |
| ------------- | ---------------------------------- |
| `release-url` | URL of the created GitHub release. |

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
