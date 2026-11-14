// In-process timer for the coach sweep.
//
// The sweep used to depend on a host crontab line under a deploy user shared
// with other projects. Another project's deploy rewrote that crontab, the line
// vanished, and no email or push went out for days with nothing reporting it.
// Running the timer inside the app removes that dependency: if the app is up,
// the coach runs.
//
// A second instance or the host cron firing as well is safe: each slot is
// claimed by a unique row before anything is sent.

export function startScheduler(opts: {
  run: () => Promise<unknown>;
  intervalMs: number;
  initialDelayMs: number;
}): () => void {
  let running = false;
  let interval: ReturnType<typeof setInterval> | undefined;

  const fire = async () => {
    // A slow sweep must not stack with the next one: two concurrent sweeps
    // would race every claim and double the database load for nothing.
    if (running) return;
    running = true;
    try {
      await opts.run();
    } catch (err) {
      console.error("scheduler: sweep failed", err);
    } finally {
      running = false;
    }
  };

  const first = setTimeout(() => {
    void fire();
    interval = setInterval(() => void fire(), opts.intervalMs);
  }, opts.initialDelayMs);

  return () => {
    clearTimeout(first);
    if (interval) clearInterval(interval);
  };
}
