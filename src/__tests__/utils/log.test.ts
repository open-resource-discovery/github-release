import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { addMask, error, info, notice, warning } from "../../utils/log.js";

describe("log", () => {
  let stdoutOutput: string[];
  let stderrOutput: string[];

  beforeEach(() => {
    stdoutOutput = [];
    stderrOutput = [];
    jest
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: unknown): boolean => {
        stdoutOutput.push(String(chunk));
        return true;
      });
    jest
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: unknown): boolean => {
        stderrOutput.push(String(chunk));
        return true;
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("info", () => {
    test("writes message to stdout with newline", () => {
      info("hello world");
      expect(stdoutOutput).toEqual(["hello world\n"]);
    });
  });

  describe("notice", () => {
    test("wraps message with ::notice:: prefix", () => {
      notice("something happened");
      expect(stdoutOutput).toEqual(["::notice::something happened\n"]);
    });

    test("escapes percent signs", () => {
      notice("50% done");
      expect(stdoutOutput).toEqual(["::notice::50%25 done\n"]);
    });

    test("escapes newlines", () => {
      notice("line1\nline2");
      expect(stdoutOutput).toEqual(["::notice::line1%0Aline2\n"]);
    });

    test("escapes carriage returns", () => {
      notice("line1\rline2");
      expect(stdoutOutput).toEqual(["::notice::line1%0Dline2\n"]);
    });
  });

  describe("warning", () => {
    test("wraps message with ::warning:: prefix on stdout", () => {
      warning("be careful");
      expect(stdoutOutput).toEqual(["::warning::be careful\n"]);
    });
  });

  describe("error", () => {
    test("writes ::error:: prefix to stderr", () => {
      error("something failed");
      expect(stderrOutput).toEqual(["::error::something failed\n"]);
      expect(stdoutOutput).toHaveLength(0);
    });

    test("escapes newlines in error message", () => {
      error("line1\nline2");
      expect(stderrOutput).toEqual(["::error::line1%0Aline2\n"]);
    });
  });

  describe("addMask", () => {
    test("emits ::add-mask:: and returns the value", () => {
      const result = addMask("secret-token");
      expect(result).toBe("secret-token");
      expect(stdoutOutput).toEqual(["::add-mask::secret-token\n"]);
    });

    test("does not emit anything for empty string", () => {
      const result = addMask("");
      expect(result).toBe("");
      expect(stdoutOutput).toHaveLength(0);
    });
  });
});
