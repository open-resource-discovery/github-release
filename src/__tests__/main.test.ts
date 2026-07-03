import { describe, expect, jest, test } from "@jest/globals";

describe("main", () => {
  test("--smoke-test prints the runtime marker and success message, then returns without reading GitHub env vars", async () => {
    const originalArgv = process.argv;
    process.argv = ["node", "main.js", "--smoke-test"];

    const writeSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    try {
      const { main } = await import("../main.js");
      await expect(main()).resolves.toBeUndefined();

      const loggedLines = writeSpy.mock.calls.map((call) => String(call[0]));
      expect(
        loggedLines.some((line) =>
          line.includes("GITHUB_RELEASE_ACTION_RUNTIME=typescript-v1"),
        ),
      ).toBe(true);
      expect(
        loggedLines.some((line) =>
          line.includes("TypeScript Docker runtime smoke test passed."),
        ),
      ).toBe(true);
    } finally {
      writeSpy.mockRestore();
      process.argv = originalArgv;
    }
  });
});
