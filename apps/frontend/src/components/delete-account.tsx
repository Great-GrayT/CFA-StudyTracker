"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { api, ApiError, signOut } from "@/lib/api";
import styles from "./delete-account.module.css";

// Deleting an account, from the bottom of Settings.
//
// Three decisions shaped this.
//
// It is collapsed. An irreversible, unrecoverable action should not be one
// misclick from the surface of a settings page, and a disclosure costs the
// person who genuinely wants it exactly one click.
//
// It counts out loud what will be destroyed. "This cannot be undone" is a
// phrase people have learned to click past; "this erases 47 logged sessions and
// 3 mock exams" is a specific loss, and specificity is what makes someone stop
// and read. The numbers come from the data the page already loaded.
//
// It asks for two different things. The credential proves it is them, which a
// live session on an unlocked laptop does not. The typed phrase proves they
// meant it, which a credential they know by heart does not. Neither substitutes
// for the other, so the server requires both and so does this form.

const PHRASE = "delete my account";

export function DeleteAccount({
  hasPassword,
  twoStepEnabled,
  counts,
}: {
  hasPassword: boolean;
  twoStepEnabled: boolean;
  counts: { logCount: number; mockCount: number; historyDays: number } | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [credential, setCredential] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);

  // Which credential this account actually has. An account that signed in with
  // Google and never set a password has neither, and the server accepts the
  // phrase alone rather than trapping it with a field it cannot fill.
  const credentialKind = hasPassword ? "password" : twoStepEnabled ? "code" : "none";
  const phraseMatches = confirmation === PHRASE;
  const credentialGiven = credentialKind === "none" || credential.trim().length > 0;

  async function handleDelete() {
    setPending(true);
    try {
      const body: Record<string, string> = { confirmation };
      if (credentialKind === "password") body.password = credential;
      // A six digit string is an authenticator code; anything else at this
      // point is a recovery code, which is how the sign-in screen reads them
      // too.
      if (credentialKind === "code") {
        const trimmed = credential.trim();
        if (/^\d{6}$/.test(trimmed)) body.totpCode = trimmed;
        else body.recoveryCode = trimmed;
      }

      await api.post("auth/account/delete", body);
      await signOut();
      toast.success("Your account and everything in it has been deleted.");
      router.replace("/login");
    } catch (err) {
      setCredential("");
      toast.error(
        err instanceof ApiError
          ? err.message
          : "Your account was not deleted. Nothing was removed. Try again.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Delete your account</h2>
      <p className={styles.lede}>
        This removes your account and every piece of work in it from the database. There is no
        copy kept and no way back. Export your data first if you might want it.
      </p>

      <details
        className={styles.details}
        open={open}
        onToggle={(event) => {
          const next = event.currentTarget.open;
          setOpen(next);
          if (!next) {
            setCredential("");
            setConfirmation("");
          }
        }}
      >
        <summary className={styles.summary}>Delete my account</summary>

        {counts && (
          <p className={styles.loss}>
            You are about to destroy{" "}
            <strong>
              {counts.logCount} logged {counts.logCount === 1 ? "session" : "sessions"}
            </strong>
            ,{" "}
            <strong>
              {counts.mockCount} mock {counts.mockCount === 1 ? "exam" : "exams"}
            </strong>{" "}
            and{" "}
            <strong>
              {counts.historyDays} {counts.historyDays === 1 ? "day" : "days"} of history
            </strong>
            , along with your plan and your sign-in.
          </p>
        )}

        {credentialKind !== "none" && (
          <div className={styles.field}>
            <label className={styles.label} htmlFor="delete-credential">
              {credentialKind === "password"
                ? "Your password"
                : "A code from your authenticator, or a recovery code"}
            </label>
            <input
              className={styles.input}
              id="delete-credential"
              type={credentialKind === "password" ? "password" : "text"}
              autoComplete={credentialKind === "password" ? "current-password" : "one-time-code"}
              value={credential}
              disabled={pending}
              onChange={(event) => setCredential(event.target.value)}
            />
          </div>
        )}

        {credentialKind === "none" && (
          <p className={styles.note}>
            You sign in with a connected account and have no password or second step set, so the
            phrase below is the only confirmation we can ask for.
          </p>
        )}

        <div className={styles.field}>
          <label className={styles.label} htmlFor="delete-confirmation">
            Type <span className={styles.phrase}>{PHRASE}</span> to confirm
          </label>
          <input
            className={styles.input}
            id="delete-confirmation"
            type="text"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            aria-describedby="delete-confirmation-help"
            value={confirmation}
            disabled={pending}
            onChange={(event) => setConfirmation(event.target.value)}
          />
          <p className={styles.help} id="delete-confirmation-help">
            {confirmation.length === 0
              ? "Exactly as written, in lower case."
              : phraseMatches
                ? "That matches."
                : "That does not match yet."}
          </p>
        </div>

        <button
          className={styles.destroy}
          type="button"
          disabled={pending || !phraseMatches || !credentialGiven}
          onClick={handleDelete}
        >
          {pending ? "Deleting" : "Delete account"}
        </button>
      </details>
    </section>
  );
}
