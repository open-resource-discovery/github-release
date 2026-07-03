import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

export function readTextFile(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

export function readTextFileIfExists(filePath: string): string | undefined {
  if (!fileExists(filePath)) {
    return undefined;
  }

  return readTextFile(filePath);
}

export function writeTextFile(filePath: string, content: string): void {
  fs.writeFileSync(filePath, content, "utf8");
}

export function appendTextFile(filePath: string, content: string): void {
  fs.appendFileSync(filePath, content, "utf8");
}

export function ensureTextFile(filePath: string, defaultContent: string): void {
  if (!fileExists(filePath)) {
    writeTextFile(filePath, defaultContent);
  }
}

export function createTempDirectory(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function removeDirectory(filePath: string): void {
  fs.rmSync(filePath, { recursive: true, force: true });
}
