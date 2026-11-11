import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Proves every prisma CLI actually loads under PLAIN node, which the rest of
 * the suite cannot do.
 *
 * Vitest runs through esbuild, which silently erases a value-shaped import of
 * a type. Plain node's type stripping does not, and fails with "does not
 * provide an export named". So that defect passes every normal test and dies
 * in production, which is exactly what happened on this branch once already.
 *
 * `args` exists because the scripts differ in what a bare invocation means.
 * Most require arguments and print usage. `seed-packages.ts` takes an optional
 * directory, so running it bare would seed the real development database from
 * a test, which is why it gets a directory that cannot exist: it still has to
 * load and reach its own error handling, which is all this test is about.
 */
const SCRIPTS: Array<{ script: string; args: string[] }> = [
  { script: "extract-meldrum.ts", args: [] },
  { script: "extract-uworld.ts", args: [] },
  { script: "propose-crosswalk.ts", args: [] },
  { script: "validate-packages.ts", args: [] },
  { script: "seed-packages.ts", args: [join(here, "__no_such_dir__")] },
];

test.each(SCRIPTS)("$script loads and runs under plain node", ({ script, args }) => {
  const res = spawnSync(process.execPath, [join(here, script), ...args], { encoding: "utf8" });
  const output = `${res.stdout}${res.stderr}`;

  // The three shapes a module-resolution or type-stripping failure takes.
  expect(output).not.toMatch(/SyntaxError/);
  expect(output).not.toMatch(/does not provide an export named/);
  expect(output).not.toMatch(/ERR_MODULE_NOT_FOUND/);

  // Reached its own error handling rather than dying on load.
  expect(res.status).not.toBe(0);
  expect(output).toMatch(/usage|cannot|could not|failed|no such/i);
});
