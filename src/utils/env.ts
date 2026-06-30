import * as fs from "node:fs";

export type Env = NodeJS.ProcessEnv;

export function getEnv(
  name: string,
  env: Env = process.env,
): string | undefined {
  const value = env[name];

  if (value === undefined || value === "") {
    return undefined;
  }

  return value;
}

export function getRequiredEnv(name: string, env: Env = process.env): string {
  const value = getEnv(name, env);

  if (value === undefined) {
    throw new Error(`${name} is required but not set.`);
  }

  return value;
}

export function getBooleanEnv(
  name: string,
  defaultValue: boolean,
  env: Env = process.env,
): boolean {
  const value = getEnv(name, env);

  if (value === undefined) {
    return defaultValue;
  }

  return value === "true";
}

export function exportEnv(
  name: string,
  value: string,
  env: Env = process.env,
): void {
  const githubEnv = getEnv("GITHUB_ENV", env);

  if (githubEnv === undefined) {
    return;
  }

  fs.appendFileSync(githubEnv, `${name}=${value}\n`, "utf8");
}
