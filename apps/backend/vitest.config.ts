import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts", "prisma/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
    // Multiple test files share one real Postgres test DB and each resets it
    // wholesale (resetDb deletes every row). Running files concurrently races
    // one file's reset/seed against another's in-flight test. Serialize them.
    fileParallelism: false,
  },
});
