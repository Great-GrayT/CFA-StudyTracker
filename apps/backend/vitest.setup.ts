// Tests run directly under Vitest, not `next dev`/`next start`, so none of
// Next.js's automatic .env loading applies here. Load .env.test ourselves so
// test code sees the same vars (JWT_SECRET, DATABASE_URL, ...) a real
// Next.js process would have, instead of each module inventing its own
// insecure fallback for "env var missing in tests".
try {
  process.loadEnvFile(".env.test");
} catch {
  // Missing in some environments (e.g. CI injecting env vars directly) - ignore.
}
