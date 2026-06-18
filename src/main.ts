import { readActionConfig } from "./config.js";
import { exportInputState } from "./release/actionState.js";
import { runPipeline } from "./release/pipeline.js";
import { addMask, error, info } from "./utils/log.js";

export async function main(): Promise<void> {
  info("GITHUB_RELEASE_ACTION_RUNTIME=typescript-v1");

  if (process.argv.slice(2).includes("--smoke-test")) {
    info("TypeScript Docker runtime smoke test passed.");
    return;
  }

  const config = readActionConfig();
  addMask(config.githubToken);
  exportInputState(config);

  await runPipeline(config);
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
