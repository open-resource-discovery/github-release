import { readActionConfig } from "./config.js";
import { addMask, error, info } from "./utils/log.js";

export async function main(): Promise<void> {
  info("GITHUB_RELEASE_ACTION_RUNTIME=typescript-v1");

  const config = readActionConfig();
  addMask(config.githubToken);

  info("Starting GitHub Release Action TypeScript runtime.");
  info(`CI workflow mode: ${config.ciWorkflows.mode}`);
  info(
    "TypeScript pipeline foundation is available. Runtime swap is intentionally blocked until pipeline parity is complete.",
  );

  // Pipeline not yet wired — keeps the async signature that will hold awaits in later slices.
  await Promise.resolve();
  throw new Error(
    "TypeScript pipeline is not wired yet. Do not switch Dockerfile to src/main.ts before migration is complete.",
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((caughtError: unknown) => {
    const message =
      caughtError instanceof Error
        ? caughtError.message
        : "An unknown error occurred.";

    error(message);
    process.exit(1);
  });
}
