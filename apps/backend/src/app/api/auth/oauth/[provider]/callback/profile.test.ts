import { test, expect } from "vitest";
import { extractVerifiedGoogleEmail, extractVerifiedGithubEmail } from "./profile";

test("extractVerifiedGoogleEmail returns the email when email_verified is true", () => {
  expect(extractVerifiedGoogleEmail({ sub: "1", email: "a@b.com", email_verified: true })).toBe("a@b.com");
});

test("extractVerifiedGoogleEmail accepts the string \"true\" some Google responses use", () => {
  expect(extractVerifiedGoogleEmail({ sub: "1", email: "a@b.com", email_verified: "true" })).toBe("a@b.com");
});

test("extractVerifiedGoogleEmail rejects an unverified email", () => {
  expect(extractVerifiedGoogleEmail({ sub: "1", email: "a@b.com", email_verified: false })).toBeNull();
});

test("extractVerifiedGoogleEmail rejects a profile with no email_verified field at all", () => {
  expect(extractVerifiedGoogleEmail({ sub: "1", email: "a@b.com" })).toBeNull();
});

test("extractVerifiedGoogleEmail rejects a verified flag with no email", () => {
  expect(extractVerifiedGoogleEmail({ sub: "1", email_verified: true })).toBeNull();
});

test("extractVerifiedGithubEmail picks the primary verified email", () => {
  const emails = [
    { email: "secondary@b.com", primary: false, verified: true },
    { email: "primary@b.com", primary: true, verified: true },
  ];
  expect(extractVerifiedGithubEmail(emails)).toBe("primary@b.com");
});

test("extractVerifiedGithubEmail rejects when the primary email is unverified, instead of falling back to another entry", () => {
  const emails = [
    { email: "primary-unverified@b.com", primary: true, verified: false },
    { email: "secondary-verified@b.com", primary: false, verified: true },
  ];
  expect(extractVerifiedGithubEmail(emails)).toBeNull();
});

test("extractVerifiedGithubEmail rejects an empty email list", () => {
  expect(extractVerifiedGithubEmail([])).toBeNull();
});
