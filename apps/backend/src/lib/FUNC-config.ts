/**
 * Deployment configuration check.
 *
 * Every variable here was already read somewhere in the app. What was missing
 * was anywhere that checked them, so the failure modes were all silent and all
 * discovered by a user rather than by an operator:
 *
 *   CRON_SECRET unset        cron/tick returns 401 to every call forever, so no
 *                            snapshot is ever written and no coach email is
 *                            ever sent. Nothing logs an error, because a 401 is
 *                            exactly what that route should return to a caller
 *                            without the secret.
 *   FRONTEND_BASE_URL unset  the coach used to fall back to a placeholder
 *                            domain, so candidates received working emails full
 *                            of dead links, unsubscribe included.
 *   VAPID keys unset         push is disabled; logged, but only at boot, where
 *                            nobody is looking a month later.
 *   SMTP unset               emails are dropped with a warning per message.
 *
 * Pure apart from reading process.env. No DB, no network, so it is cheap enough
 * to serve from a health endpoint on every probe.
 */

export type ConfigIssue = { variable: string; detail: string };

export type ConfigReport = {
  /** False when something is wrong that will break a user-visible feature. */
  ok: boolean;
  /** Breaks something. A deploy with any of these should not be considered live. */
  errors: ConfigIssue[];
  /** Degrades something. The app runs; a feature is off. */
  warnings: ConfigIssue[];
  /** Feature switches, derived rather than configured, for an operator to eyeball. */
  features: Record<string, boolean>;
};

function isSet(name: string): boolean {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Placeholders that look configured but are not. A deploy that copied
 * .env.example and changed only the database URL would otherwise pass every
 * presence check while signing tokens with a published secret.
 */
const PLACEHOLDERS = [
  "your-secret-key-here",
  "your-cron-secret-here",
  "your-vapid-public-key",
  "your-vapid-private-key",
  "admin@example.com",
  "app.example.com",
  "example.com",
];

function looksLikePlaceholder(name: string): boolean {
  const value = process.env[name];
  if (!value) return false;
  const lowered = value.toLowerCase();
  return PLACEHOLDERS.some((p) => lowered.includes(p));
}

export function checkConfig(): ConfigReport {
  const errors: ConfigIssue[] = [];
  const warnings: ConfigIssue[] = [];

  // Nothing works without these two.
  for (const name of ["DATABASE_URL", "JWT_SECRET"]) {
    if (!isSet(name)) {
      errors.push({ variable: name, detail: "not set, and nothing works without it" });
    }
  }

  // JWT_SECRET also signs the unsubscribe tokens, so a weak one is worse than
  // it looks: it lets anyone turn off anyone else's coaching.
  if (isSet("JWT_SECRET")) {
    if (looksLikePlaceholder("JWT_SECRET")) {
      errors.push({
        variable: "JWT_SECRET",
        detail: "still the published example value, so every token is forgeable",
      });
    } else if ((process.env.JWT_SECRET ?? "").length < 32) {
      warnings.push({
        variable: "JWT_SECRET",
        detail: "shorter than 32 characters; it also signs unsubscribe tokens",
      });
    }
  }

  if (!isSet("FRONTEND_BASE_URL")) {
    errors.push({
      variable: "FRONTEND_BASE_URL",
      detail:
        "not set; coach emails, password resets and every passkey ceremony all build links from it",
    });
  } else if (looksLikePlaceholder("FRONTEND_BASE_URL")) {
    errors.push({
      variable: "FRONTEND_BASE_URL",
      detail: "still an example domain, so emailed links would be dead on arrival",
    });
  }

  if (!isSet("CRON_SECRET")) {
    errors.push({
      variable: "CRON_SECRET",
      detail:
        "not set, so cron/tick rejects every call: no snapshots and no coach emails, silently",
    });
  } else if (looksLikePlaceholder("CRON_SECRET")) {
    errors.push({
      variable: "CRON_SECRET",
      detail: "still the published example value, so anyone can trigger the batch",
    });
  }

  const smtp = ["SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD"].every(isSet);
  if (!smtp) {
    warnings.push({
      variable: "SMTP_HOST, SMTP_USER, SMTP_PASSWORD",
      detail: "incomplete, so no email is sent at all: no coach, no password reset",
    });
  }

  const vapidSet = ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"].every(isSet);
  const vapidPlaceholder = ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"].some(
    looksLikePlaceholder
  );
  if (!vapidSet) {
    warnings.push({
      variable: "VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT",
      detail: "incomplete, so phone notifications are disabled",
    });
  } else if (vapidPlaceholder) {
    warnings.push({
      variable: "VAPID keys",
      detail: "still example values, so push sending will be rejected at send time",
    });
  }

  // A subject that is a bare address rather than a URL makes web-push throw on
  // startup, which is the commonest VAPID misconfiguration by a distance.
  const subject = process.env.VAPID_SUBJECT;
  if (subject && !/^(mailto:|https?:\/\/)/.test(subject)) {
    errors.push({
      variable: "VAPID_SUBJECT",
      detail: `must start with "mailto:" or "https://", got "${subject}"`,
    });
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    features: {
      email: smtp,
      push: vapidSet && !vapidPlaceholder,
      oauthGoogle: isSet("GOOGLE_CLIENT_ID") && isSet("GOOGLE_CLIENT_SECRET"),
      oauthGithub: isSet("GITHUB_CLIENT_ID") && isSet("GITHUB_CLIENT_SECRET"),
    },
  };
}
