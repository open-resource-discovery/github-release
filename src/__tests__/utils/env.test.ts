import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  exportEnv,
  getBooleanEnv,
  getEnv,
  getRequiredEnv,
} from "../../utils/env.js";

describe("getEnv", () => {
  test("returns value when set", () => {
    const env = { MY_VAR: "hello" };
    expect(getEnv("MY_VAR", env)).toBe("hello");
  });

  test("returns undefined when not set", () => {
    expect(getEnv("MISSING", {})).toBeUndefined();
  });

  test("uses process.env by default", () => {
    expect(getEnv("__DEFINITELY_NOT_SET_VAR_XYZ123__")).toBeUndefined();
  });

  test("returns undefined for empty string", () => {
    const env = { MY_VAR: "" };
    expect(getEnv("MY_VAR", env)).toBeUndefined();
  });
});

describe("getRequiredEnv", () => {
  test("returns value when set", () => {
    const env = { MY_VAR: "value" };
    expect(getRequiredEnv("MY_VAR", env)).toBe("value");
  });

  test("throws when not set", () => {
    expect(() => getRequiredEnv("MISSING", {})).toThrow(
      "MISSING is required but not set.",
    );
  });

  test("uses process.env by default and throws for missing var", () => {
    expect(() =>
      getRequiredEnv("__DEFINITELY_NOT_SET_VAR_XYZ123__"),
    ).toThrow("__DEFINITELY_NOT_SET_VAR_XYZ123__ is required but not set.");
  });

  test("throws when empty string", () => {
    expect(() => getRequiredEnv("MY_VAR", { MY_VAR: "" })).toThrow(
      "MY_VAR is required but not set.",
    );
  });
});

describe("getBooleanEnv", () => {
  test("uses process.env by default and returns default for missing var", () => {
    expect(getBooleanEnv("__DEFINITELY_NOT_SET_VAR_XYZ123__", false)).toBe(
      false,
    );
  });

  test("returns true only for exact string 'true'", () => {
    expect(getBooleanEnv("FLAG", false, { FLAG: "true" })).toBe(true);
  });

  test("returns false for 'TRUE' (case-sensitive)", () => {
    expect(getBooleanEnv("FLAG", false, { FLAG: "TRUE" })).toBe(false);
  });

  test("returns false for '1'", () => {
    expect(getBooleanEnv("FLAG", false, { FLAG: "1" })).toBe(false);
  });

  test("returns false for 'yes'", () => {
    expect(getBooleanEnv("FLAG", false, { FLAG: "yes" })).toBe(false);
  });

  test("uses default when not set", () => {
    expect(getBooleanEnv("FLAG", true, {})).toBe(true);
    expect(getBooleanEnv("FLAG", false, {})).toBe(false);
  });

  test("uses default when empty string", () => {
    expect(getBooleanEnv("FLAG", true, { FLAG: "" })).toBe(true);
  });
});

describe("exportEnv", () => {
  let tempDir: string;
  let githubEnvFile: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "env-test-"));
    githubEnvFile = path.join(tempDir, "github.env");
    fs.writeFileSync(githubEnvFile, "", "utf8");
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("appends NAME=value to GITHUB_ENV file", () => {
    exportEnv("MY_VAR", "hello", { GITHUB_ENV: githubEnvFile });
    expect(fs.readFileSync(githubEnvFile, "utf8")).toBe("MY_VAR=hello\n");
  });

  test("appends multiple entries", () => {
    const env = { GITHUB_ENV: githubEnvFile };
    exportEnv("FIRST", "a", env);
    exportEnv("SECOND", "b", env);
    expect(fs.readFileSync(githubEnvFile, "utf8")).toBe("FIRST=a\nSECOND=b\n");
  });

  test("does nothing when GITHUB_ENV is not set", () => {
    expect(() => exportEnv("MY_VAR", "val", {})).not.toThrow();
  });
});
