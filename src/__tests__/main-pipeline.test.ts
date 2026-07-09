import { beforeAll, describe, expect, jest, test } from "@jest/globals";
import type { ActionConfig } from "../config.js";

const mockRunPipeline = jest.fn<(config: ActionConfig) => Promise<void>>();

jest.unstable_mockModule("../release/pipeline.js", () => ({
  runPipeline: mockRunPipeline,
}));

const mockConfig: ActionConfig = {
  githubToken: "test-token",
  dryRun: false,
  releaseDraft: false,
  releasePrerelease: false,
  releaseTitlePrefix: "",
  tagTemplate: "v<version>",
  changelogFilePath: "CHANGELOG.md",
  versionOverride: undefined,
  ciWorkflows: { mode: "auto" },
  githubServerUrl: "https://github.com",
  githubApiUrl: "https://api.github.com",
  githubRepository: "owner/repo",
  githubActor: "actor",
  githubWorkspace: "/workspace",
};

jest.unstable_mockModule("../config.js", () => ({
  readActionConfig: jest.fn().mockReturnValue(mockConfig),
}));

let mainFn: () => Promise<void>;

beforeAll(async () => {
  const mod = await import("../main.js");
  mainFn = mod.main;
});

describe("main (pipeline path)", () => {
  test("calls runPipeline when --smoke-test is not set", async () => {
    const originalArgv = process.argv;
    process.argv = ["node", "main.js"];
    mockRunPipeline.mockResolvedValue(undefined);

    const writeSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    try {
      await expect(mainFn()).resolves.toBeUndefined();
      expect(mockRunPipeline).toHaveBeenCalledTimes(1);
      expect(mockRunPipeline).toHaveBeenCalledWith(mockConfig);
    } finally {
      writeSpy.mockRestore();
      process.argv = originalArgv;
      mockRunPipeline.mockReset();
    }
  });

  test("propagates errors thrown by runPipeline", async () => {
    const originalArgv = process.argv;
    process.argv = ["node", "main.js"];
    mockRunPipeline.mockRejectedValue(new Error("pipeline failed"));

    const writeSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    try {
      await expect(mainFn()).rejects.toThrow("pipeline failed");
    } finally {
      writeSpy.mockRestore();
      process.argv = originalArgv;
      mockRunPipeline.mockReset();
    }
  });
});
