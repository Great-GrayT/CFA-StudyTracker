// Pure routing rules, shared by middleware and tests. No imports, so it is safe
// on the edge runtime.
export const APP_ROUTES: readonly string[] = [
  "/today",
  "/syllabus",
  "/progress",
  "/packages",
  "/plan",
  "/settings",
  "/onboarding",
];

export function needsLogin(pathname: string, hasSession: boolean): boolean {
  if (hasSession) return false;
  return APP_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`));
}

// Wired into next.config.ts redirects. Order matters: /coverage/explore must
// precede /coverage/:topicId.
export const LEGACY_REDIRECTS: { source: string; destination: string; permanent: false }[] = [
  { source: "/coverage", destination: "/syllabus", permanent: false },
  { source: "/coverage/explore", destination: "/syllabus?view=3d", permanent: false },
  { source: "/coverage/:topicId", destination: "/syllabus/:topicId", permanent: false },
  { source: "/los/:losId", destination: "/syllabus?los=:losId", permanent: false },
  { source: "/pace", destination: "/progress?tab=pace", permanent: false },
  { source: "/mocks", destination: "/progress?tab=mocks", permanent: false },
  { source: "/logs", destination: "/progress?tab=journal", permanent: false },
  { source: "/watchdogs", destination: "/settings#system", permanent: false },
];
