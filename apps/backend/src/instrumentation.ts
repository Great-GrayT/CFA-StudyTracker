// Next.js calls register() once per server process at startup. The coach
// sweep is scheduled from here so it runs whenever the app runs, with no host
// crontab involved (see lib/FUNC-scheduler.ts for why).
//
// The runtime check must wrap the import inline: Next also builds this file
// for the edge runtime, and only an inline check lets webpack drop the Node
// modules (web-push, Prisma) from that bundle.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startCoachScheduler } = await import("./instrumentation-node");
    startCoachScheduler();
  }
}
