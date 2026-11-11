// Which backend paths the same-origin proxy will forward.
//
// Its own module rather than living in the route, for two reasons. Next.js
// rejects any export from a route file that is not a handler, so the predicate
// could not be tested in place. And the way this fails deserves a test: an
// unlisted path returns 404 even though the backend route exists, is
// authenticated, and is covered by its own tests, so the feature simply does
// not work in the browser and nothing says why.
//
// That is not hypothetical. The study-location city picker shipped against
// `geocode`, which was not listed, so the backend endpoint, its validation and
// its tests were all correct while the picker was dead on arrival.

/**
 * An allowlist, not a passthrough. Without it the proxy would forward any path
 * a caller invents, including ones added to the backend later that were never
 * meant to be reachable from a browser. The cron tick is the live example: it
 * is protected by a shared secret, not a user JWT.
 *
 * Anchor both ends unless the subtree is genuinely meant to be open. `^plans(\/|$)`
 * is broad on purpose, since the plan subtree is the app's main surface;
 * `^settings$` is not, so nothing the backend later mounts beneath it is
 * admitted by accident.
 */
export const ALLOWED = [
  /^plans(\/|$)/,
  /^packages(\/|$)/,
  /^logs(\/|$)/,
  /^mock-exams(\/|$)/,
  /^progress$/,
  /^curriculum(\/|$)/,
  /^export\/(all|log)$/,
  /^push\/subscribe$/,
  /^push\/subscriptions(\/|$)/,
  /^cron\/(runs|run)$/,
  /^auth\/me$/,
  /^auth\/password$/,
  /^auth\/2fa\/(setup|enable|disable)$/,
  /^auth\/passkey\/register-(options|verify)$/,
  /^auth\/passkeys(\/|$)/,
  // The settings screen's one-shot read of everything the user can manage.
  /^settings$/,
  // City lookup for the study-location picker.
  /^geocode$/,
];

/**
 * Password reset is the one flow that must work WITHOUT a session: a user who
 * has forgotten their password has no token to send. These forward unauthed.
 */
export const PUBLIC = [
  /^auth\/forgot-password$/,
  /^auth\/reset-password$/,
  // Signing in cannot require a session. The second step and passkey login
  // both happen before one exists.
  /^auth\/2fa\/verify$/,
  /^auth\/passkey\/login-(options|verify)$/,
];

export function allowed(path: string): boolean {
  return ALLOWED.some((re) => re.test(path));
}

export function isPublicPath(path: string): boolean {
  return PUBLIC.some((re) => re.test(path));
}
