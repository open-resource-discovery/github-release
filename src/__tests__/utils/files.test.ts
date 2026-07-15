import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  appendTextFile,
  ensureTextFile,
  readTextFileIfExists,
} from "../../utils/files.js";

describe("files", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "files-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("readTextFileIfExists", () => {
    test("returns undefined when the file does not exist", () => {
      expect(
        readTextFileIfExists(path.join(tmpDir, "missing.txt")),
      ).toBeUndefined();
    });

    test("returns the file content when the file exists", () => {
      const filePath = path.join(tmpDir, "exists.txt");
      fs.writeFileSync(filePath, "hello", "utf8");
      expect(readTextFileIfExists(filePath)).toBe("hello");
    });
  });

  describe("ensureTextFile", () => {
    test("creates the file with default content when it does not exist", () => {
      const filePath = path.join(tmpDir, "new.txt");
      ensureTextFile(filePath, "default content");
      expect(fs.readFileSync(filePath, "utf8")).toBe("default content");
    });

    test("does not overwrite an existing file", () => {
      const filePath = path.join(tmpDir, "existing.txt");
      fs.writeFileSync(filePath, "original", "utf8");
      ensureTextFile(filePath, "default content");
      expect(fs.readFileSync(filePath, "utf8")).toBe("original");
    });
  });

  describe("appendTextFile", () => {
    test("appends content to an existing file", () => {
      const filePath = path.join(tmpDir, "log.txt");
      fs.writeFileSync(filePath, "line1\n", "utf8");
      appendTextFile(filePath, "line2\n");
      expect(fs.readFileSync(filePath, "utf8")).toBe("line1\nline2\n");
    });
  });
});
