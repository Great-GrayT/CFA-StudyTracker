import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { startScheduler } from "../../src/lib/FUNC-scheduler";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test("runs once after the initial delay, then on every interval", async () => {
  const run = vi.fn().mockResolvedValue(undefined);
  const stop = startScheduler({ run, intervalMs: 1000, initialDelayMs: 100 });

  await vi.advanceTimersByTimeAsync(99);
  expect(run).toHaveBeenCalledTimes(0);
  await vi.advanceTimersByTimeAsync(1);
  expect(run).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(2000);
  expect(run).toHaveBeenCalledTimes(3);

  stop();
  await vi.advanceTimersByTimeAsync(5000);
  expect(run).toHaveBeenCalledTimes(3);
});

test("a sweep still running when the next one is due is not overlapped", async () => {
  let finish!: () => void;
  const run = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const stop = startScheduler({ run, intervalMs: 1000, initialDelayMs: 0 });

  await vi.advanceTimersByTimeAsync(3500);
  expect(run).toHaveBeenCalledTimes(1);

  finish();
  await vi.advanceTimersByTimeAsync(1000);
  expect(run).toHaveBeenCalledTimes(2);
  stop();
});

test("a sweep that throws is logged and the schedule keeps going", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const run = vi.fn().mockRejectedValueOnce(new Error("db down")).mockResolvedValue(undefined);
  const stop = startScheduler({ run, intervalMs: 1000, initialDelayMs: 0 });

  await vi.advanceTimersByTimeAsync(0);
  expect(error).toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1000);
  expect(run).toHaveBeenCalledTimes(2);
  stop();
});
