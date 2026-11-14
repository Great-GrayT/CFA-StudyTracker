import { createTransport, type Transporter } from "nodemailer";

// Mail transport, shared by password reset and the email study coach
// (FUNC-coach.ts). The v1 spec's "no email reminders" non-goal has been
// revisited and reversed for the coach - see
// docs/superpowers/specs/2026-11-11-email-coach-design.md - so this file no
// longer carries that restriction, only the plumbing both callers need.
//
// SMTP rather than a provider SDK, so the deployment can point at whatever it
// already has (a mailbox, a relay, a transactional service with SMTP) without
// this code knowing or caring.

export type Mail = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /**
   * Extra SMTP headers. The coach uses this for List-Unsubscribe and
   * List-Unsubscribe-Post, which is what makes Gmail and Outlook render their
   * own native unsubscribe control next to the sender name.
   *
   * That control matters more than it looks. Without it the only exit a
   * frustrated recipient can find is the "report spam" button, and a few of
   * those take the whole sending domain's reputation down, which silently
   * costs every other email the app sends, password resets included.
   */
  headers?: Record<string, string>;
  /** Sets X-Priority, X-MSMail-Priority and Importance. Outlook and Apple Mail
   * flag it; Gmail ignores it and decides "important" itself. */
  priority?: "high" | "normal" | "low";
};

let cached: Transporter | null = null;

function transport(): Transporter | null {
  if (cached) return cached;

  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  if (!host || !user || !pass) return null;

  const port = Number(process.env.SMTP_PORT ?? 587);
  cached = createTransport({
    host,
    port,
    // Implicit TLS on 465, STARTTLS everywhere else. Getting this backwards is
    // the usual cause of a connection that hangs rather than fails.
    secure: port === 465,
    auth: { user, pass },
  });
  return cached;
}

/** True when the deployment is configured to send at all. */
export function mailConfigured(): boolean {
  return transport() !== null;
}

export async function sendMail(mail: Mail): Promise<void> {
  const t = transport();
  if (!t) {
    // Loud in development, where this is almost always a missing .env rather
    // than a deliberate choice. The caller still reports success to the user,
    // because the response must not reveal whether an address exists.
    console.warn(`mail not configured, dropping message to ${mail.to}: ${mail.subject}`);
    return;
  }

  await t.sendMail({
    from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    headers: mail.headers,
    priority: mail.priority,
  });
}
