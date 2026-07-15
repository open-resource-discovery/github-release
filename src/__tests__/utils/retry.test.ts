import { describe, expect, test } from "@jest/globals";
import { retryUntil } from "../../utils/retry.js";

const noSleep = (): Promise<void> => Promise.resolve();

describe("retryUntil", () => {
  test("returns immediately when operation succeeds on first attempt", async () => {
    const result = await retryUntil(
      () => Promise.resolve("value" as string | undefined),
      {
        maxAttempts: 3,
        intervalMs: 0,
        description: "test",
        sleep: noSleep,
      },
    );
    expect(result).toBe("value");
  });

  test("retries and returns when operation eventually succeeds", async () => {
    let calls = 0;
    const result = await retryUntil(
      () => {
        calls += 1;
        const value: string | undefined = calls >= 3 ? "done" : undefined;
        return Promise.resolve(value);
      },
      { maxAttempts: 5, intervalMs: 0, description: "test", sleep: noSleep },
    );
    expect(result).toBe("done");
    expect(calls).toBe(3);
  });

  test("throws after maxAttempts when operation never succeeds", async () => {
    await expect(
      retryUntil(() => Promise.resolve(undefined), {
        maxAttempts: 3,
        intervalMs: 0,
        description: "workflow run",
        sleep: noSleep,
      }),
    ).rejects.toThrow(
      "Timed out while waiting for workflow run after 3 attempts.",
    );
  });

  test("treats null as not-yet-found", async () => {
    let calls = 0;
    const result = await retryUntil(
      () => {
        calls += 1;
        const value: number | null = calls >= 2 ? 42 : null;
        return Promise.resolve(value);
      },
      { maxAttempts: 5, intervalMs: 0, description: "test", sleep: noSleep },
    );
    expect(result).toBe(42);
  });

  test("treats false as not-yet-found", async () => {
    let calls = 0;
    const result = await retryUntil(
      () => {
        calls += 1;
        const value: string | false = calls >= 2 ? "found" : false;
        return Promise.resolve(value);
      },
      { maxAttempts: 5, intervalMs: 0, description: "test", sleep: noSleep },
    );
    expect(result).toBe("found");
  });

  test("calls onRetry on each failed attempt except the last", async () => {
    const retryCalls: number[] = [];
    await expect(
      retryUntil(() => Promise.resolve(undefined), {
        maxAttempts: 3,
        intervalMs: 0,
        description: "x",
        sleep: noSleep,
        onRetry: (attempt) => {
          retryCalls.push(attempt);
        },
      }),
    ).rejects.toThrow();
    expect(retryCalls).toEqual([1, 2]);
  });
});
