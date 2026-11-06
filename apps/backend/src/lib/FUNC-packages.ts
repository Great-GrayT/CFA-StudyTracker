import { db } from "./db";

/**
 * Guards every caller-supplied `packageId` against cross-tenant use: a
 * StudyPackage is usable by `userId` only if it's a shared/official preset
 * (`userId: null`) or the caller's own custom package. Without this check,
 * a caller could attach (and in plans/[id]/packages's GET, read back the
 * name of) another user's private package - a real cross-tenant data leak,
 * not just a theoretical FK gap.
 *
 * Returns a ready-to-send Response when the package isn't usable (so every
 * call site gets the same clean 400/403 instead of letting a bad id fall
 * through to a Prisma FK-constraint 500), or `null` when it's fine to
 * proceed.
 */
export async function assertUsablePackage(packageId: string, userId: string): Promise<Response | null> {
  const pkg = await db.studyPackage.findUnique({ where: { id: packageId } });
  if (!pkg) {
    return Response.json({ error: "Invalid packageId" }, { status: 400 });
  }
  // Same 403-not-404-shaped convention as every other ownership check in
  // this codebase: the package exists, the caller just isn't allowed to use it.
  if (pkg.userId !== null && pkg.userId !== userId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}
