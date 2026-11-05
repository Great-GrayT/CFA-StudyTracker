// Pure (no network, no DB) extraction of a *verified* email from each
// provider's profile payload. Split out from the fetch calls in route.ts
// so this fail-closed logic is unit-testable on its own: an OAuth login
// that hands back an unverified email must never reach
// linkOrCreateOauthUser, since that function trusts the email to look up
// (and silently attach to) an existing password-registered account.

export interface GoogleProfile {
  sub: string;
  email?: string;
  email_verified?: boolean | string;
}

export interface GithubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

// Google's v3 userinfo endpoint returns email_verified as a boolean, but
// some Google API surfaces have returned it as the string "true" - accept
// either, treat anything else (including absent) as unverified.
export function extractVerifiedGoogleEmail(profile: GoogleProfile): string | null {
  const verified = profile.email_verified === true || profile.email_verified === "true";
  if (!verified || !profile.email) {
    return null;
  }
  return profile.email;
}

// Fail closed: only the account's primary, verified address counts.
// GitHub's /user/emails can list secondary, unverified, or noreply
// placeholder addresses - falling back to "the first one in the list"
// would accept an unverified (or attacker-added) address, so an unmatched
// list rejects the login instead of guessing.
export function extractVerifiedGithubEmail(emails: GithubEmail[]): string | null {
  return emails.find((e) => e.primary && e.verified)?.email ?? null;
}
