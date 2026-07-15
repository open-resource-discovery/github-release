export type RetryOptions = {
  maxAttempts: number;
  intervalMs: number;
  description: string;
  sleep?: (milliseconds: number) => Promise<void>;
  onRetry?: (attempt: number) => void;
};

export async function sleep(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export async function retryUntil<T>(
  operation: (attempt: number) => Promise<T | undefined | null | false>,
  options: RetryOptions,
): Promise<T> {
  const sleepFn = options.sleep ?? sleep;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    const result = await operation(attempt);

    if (result !== undefined && result !== null && result !== false) {
      return result;
    }

    if (attempt < options.maxAttempts) {
      options.onRetry?.(attempt);
      await sleepFn(options.intervalMs);
    }
  }

  throw new Error(
    `Timed out while waiting for ${options.description} after ${options.maxAttempts} attempts.`,
  );
}
