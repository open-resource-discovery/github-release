import {
  getBooleanEnv,
  getEnv,
  getRequiredEnv,
  type Env,
} from "./utils/env.js";

export type CiWorkflowsConfig =
  | {
      mode: "auto";
    }
  | {
      mode: "disabled";
    }
  | {
      mode: "explicit";
      workflows: string[];
    };

export type ActionConfig = {
  githubToken: string;
  dryRun: boolean;
  releaseDraft: boolean;
  releasePrerelease: boolean;
  releaseTitlePrefix: string;
  tagTemplate: string;
  changelogFilePath: string;
  versionOverride?: string;
  ciWorkflows: CiWorkflowsConfig;
  githubServerUrl: string;
  githubApiUrl: string;
  githubRepository: string;
  githubActor: string;
  githubWorkspace: string;
  githubRefName?: string;
  githubBaseRef?: string;
  githubWorkflowRef?: string;
};

function parseCiWorkflows(value: string | undefined): CiWorkflowsConfig {
  const normalized = value?.trim();

  if (normalized === undefined || normalized === "" || normalized === "auto") {
    return { mode: "auto" };
  }

  if (normalized === "none" || normalized === "false") {
    return { mode: "disabled" };
  }

  const workflows = normalized
    .split(",")
    .map((workflow) => workflow.trim())
    .filter((workflow) => workflow.length > 0);

  if (workflows.length === 0) {
    return { mode: "auto" };
  }

  return {
    mode: "explicit",
    workflows,
  };
}

export function readActionConfig(env: Env = process.env): ActionConfig {
  const githubToken =
    getEnv("INPUT_GITHUB-TOKEN", env) ?? getRequiredEnv("GITHUB_TOKEN", env);

  const versionOverride = getEnv("INPUT_VERSION", env);

  return {
    githubToken,
    dryRun: getBooleanEnv("INPUT_DRY-RUN", false, env),
    releaseDraft: getBooleanEnv("INPUT_RELEASE-DRAFT", false, env),
    releasePrerelease: getBooleanEnv("INPUT_RELEASE-PRERELEASE", false, env),
    releaseTitlePrefix: getEnv("INPUT_RELEASE-TITLE-PREFIX", env) ?? "",
    tagTemplate: getEnv("INPUT_TAG-TEMPLATE", env) ?? "v<version>",
    changelogFilePath:
      getEnv("INPUT_CHANGELOG-FILE-PATH", env) ?? "CHANGELOG.md",
    versionOverride,
    ciWorkflows: parseCiWorkflows(getEnv("INPUT_CI-WORKFLOWS", env)),
    githubServerUrl: getRequiredEnv("GITHUB_SERVER_URL", env),
    githubApiUrl: getRequiredEnv("GITHUB_API_URL", env),
    githubRepository: getRequiredEnv("GITHUB_REPOSITORY", env),
    githubActor: getRequiredEnv("GITHUB_ACTOR", env),
    githubWorkspace: getRequiredEnv("GITHUB_WORKSPACE", env),
    githubRefName: getEnv("GITHUB_REF_NAME", env),
    githubBaseRef: getEnv("GITHUB_BASE_REF", env),
    githubWorkflowRef: getEnv("GITHUB_WORKFLOW_REF", env),
  };
}
