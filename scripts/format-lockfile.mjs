import { readFileSync, writeFileSync } from "node:fs";

const lockfile = new URL("../package-lock.json", import.meta.url);
const original = readFileSync(lockfile, "utf8");
const formatted = `${JSON.stringify(JSON.parse(original), null, 2)}\n`;

if (original !== formatted) {
  if (process.argv.includes("--check")) {
    console.error("package-lock.json needs formatting. Run npm run format.");
    process.exitCode = 1;
  } else {
    writeFileSync(lockfile, formatted);
  }
}
