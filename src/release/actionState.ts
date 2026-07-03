import type { ActionConfig, CiWorkflowsConfig } from "../config.js";
import { exportEnv } from "../utils/env.js";
import type { ChangelogPrResult } from "./createChangelogPr.js";
import type { ReleaseSetup } from "./setupRelease.js";

function serializeCiWorkflows(config: CiWorkflowsConfig): string {
  switch (config.mode) {
    case "auto":
      return "auto";
    case "disabled":
      return "none";
    case "explicit":
      return config.workflows.join(",");
  }
}

export function exportInputState(config: ActionConfig): void {
  exportEnv("DRY_RUN", String(config.dryRun));
  exportEnv("CHANGELOG_FILE_PATH", config.changelogFilePath);
  exportEnv("TAG_TEMPLATE", config.tagTemplate);
  exportEnv("RELEASE_DRAFT", String(config.releaseDraft));
  exportEnv("RELEASE_PRERELEASE", String(config.releasePrerelease));
  exportEnv("RELEASE_TITLE_PREFIX", config.releaseTitlePrefix);
  exportEnv("VERSION_OVERRIDE", config.versionOverride ?? "");
  exportEnv("CI_WORKFLOWS", serializeCiWorkflows(config.ciWorkflows));
}

export function exportSetupState(setup: ReleaseSetup): void {
  exportEnv("VERSION", setup.version);
  exportEnv("TAG", setup.tag);
  exportEnv("RELEASE_TITLE", setup.releaseTitle);
  exportEnv("TAG_EXISTS", String(setup.tagExists));
  exportEnv("RELEASE_EXISTS", String(setup.releaseExists));
  exportEnv("TARGET_BRANCH", setup.targetBranch);

  if (setup.latestTag !== undefined) {
    exportEnv("LATEST_TAG", setup.latestTag);
  }
}

export function exportChangelogState(updated: boolean): void {
  exportEnv("CHANGELOG_UPDATED", String(updated));
}

export function exportPrState(result: ChangelogPrResult): void {
  exportEnv("PR_URL", result.prUrl);
  exportEnv("CHANGELOG_PR_HEAD_SHA", result.headSha);
}
