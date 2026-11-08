"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { registerPasskey, isPasskeySupported } from "@/lib/auth-client";
import styles from "./security-settings.module.css";

// Passkeys and two-step sign in, managed from Settings.
//
// Both are opt in and both are reversible, which is why each destructive step
// says what it costs before it happens rather than after.

type Passkey = {
  id: string;
  label: string | null;
  deviceType: string | null;
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
};

type Me = { id: string; email: string; twoStepEnabled?: boolean };

export function SecuritySettings({ twoStepEnabled }: { twoStepEnabled: boolean }) {
  const [supported, setSupported] = useState(false);
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [enabled, setEnabled] = useState(twoStepEnabled);
  const [setup, setSetup] = useState<{ otpauthUri: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [disablePassword, setDisablePassword] = useState("");
  const [disabling, setDisabling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSupported(isPasskeySupported());
    void loadPasskeys();
  }, []);

  async function loadPasskeys() {
    try {
      const res = await api.get<{ passkeys: Passkey[] }>("auth/passkeys");
      setPasskeys(res.passkeys);
    } catch {
      // A failed list is not worth an error banner on a settings screen.
    }
  }

  async function addPasskey() {
    setError(null);
    try {
      const label = typeof navigator !== "undefined" ? navigator.platform || "This device" : undefined;
      await registerPasskey(label);
      toast.success("Passkey added.");
      await loadPasskeys();
    } catch (err) {
      if (err instanceof DOMException && err.name === "NotAllowedError") return;
      setError(err instanceof ApiError ? err.message : "That passkey could not be added.");
    }
  }

  async function removePasskey(id: string) {
    setError(null);
    try {
      await api.del(`auth/passkeys/${id}`);
      toast.success("Passkey removed.");
      await loadPasskeys();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not remove that passkey.");
    }
  }

  async function beginTwoStep() {
    setError(null);
    try {
      const res = await api.post<{ otpauthUri: string; secret: string }>("auth/2fa/setup", {});
      setSetup(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not start setup.");
    }
  }

  async function confirmTwoStep(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await api.post<{ recoveryCodes: string[] }>("auth/2fa/enable", { code });
      setRecoveryCodes(res.recoveryCodes);
      setEnabled(true);
      setSetup(null);
      setCode("");
      toast.success("Two-step sign in is on.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That code is not right.");
    }
  }

  async function turnOff(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post("auth/2fa/disable", { password: disablePassword });
      setEnabled(false);
      setDisabling(false);
      setDisablePassword("");
      toast.success("Two-step sign in is off.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That password is not right.");
    }
  }

  return (
    <section className={styles.section} aria-labelledby="security-heading">
      <h2 id="security-heading" className={styles.heading}>
        Security
      </h2>

      <section className={styles.block}>
        <h3 className={styles.subheading}>Passkeys</h3>
        <p className={styles.hint}>
          Sign in with your fingerprint, face, or device PIN instead of a password. A passkey
          cannot be phished, because it only works on this site.
        </p>

        {passkeys.length > 0 ? (
          <ul className={styles.list}>
            {passkeys.map((p) => (
              <li key={p.id} className={styles.row}>
                <span className={styles.rowMain}>
                  <span className={styles.rowName}>{p.label ?? "Passkey"}</span>
                  <span className={styles.rowMeta}>
                    Added {new Date(p.createdAt).toLocaleDateString()}
                    {p.lastUsedAt
                      ? `, last used ${new Date(p.lastUsedAt).toLocaleDateString()}`
                      : ", not used yet"}
                    {p.backedUp ? ", synced" : ""}
                  </span>
                </span>
                <button
                  type="button"
                  className={styles.remove}
                  onClick={() => removePasskey(p.id)}
                  aria-label={`Remove ${p.label ?? "this passkey"}`}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.empty}>No passkeys yet.</p>
        )}

        {supported ? (
          <button type="button" className={styles.action} onClick={addPasskey}>
            Add a passkey
          </button>
        ) : (
          <p className={styles.empty}>This browser does not support passkeys.</p>
        )}
      </section>

      <section className={styles.block}>
        <h3 className={styles.subheading}>Two-step sign in</h3>

        {enabled ? (
          <>
            <p className={styles.hint}>
              On. You are asked for a code from your authenticator app each time you sign in with
              your password.
            </p>
            {disabling ? (
              <form onSubmit={turnOff}>
                <p className={styles.hint}>
                  Confirm your password to turn it off. This also deletes your recovery codes.
                </p>
                <label className={styles.label} htmlFor="disable-password">
                  Password
                </label>
                <input
                  id="disable-password"
                  type="password"
                  autoComplete="current-password"
                  className={styles.input}
                  value={disablePassword}
                  onChange={(e) => setDisablePassword(e.target.value)}
                />
                <div className={styles.actions}>
                  <button type="submit" className={styles.danger}>
                    Turn off two-step
                  </button>
                  <button
                    type="button"
                    className={styles.action}
                    onClick={() => setDisabling(false)}
                  >
                    Keep it on
                  </button>
                </div>
              </form>
            ) : (
              <button type="button" className={styles.action} onClick={() => setDisabling(true)}>
                Turn off two-step
              </button>
            )}
          </>
        ) : setup ? (
          <form onSubmit={confirmTwoStep}>
            <p className={styles.hint}>
              Scan this with your authenticator app, then enter the code it shows.
            </p>
            {/* The URI is rendered as text as well as a link: a QR image would
                mean either a canvas dependency or fetching a picture of the
                secret from someone else's server. */}
            <a className={styles.otpauth} href={setup.otpauthUri}>
              Open in your authenticator app
            </a>
            <p className={styles.hint}>
              Or type this key in by hand: <code className={styles.secret}>{setup.secret}</code>
            </p>
            <label className={styles.label} htmlFor="totp-code">
              Code from the app
            </label>
            <input
              id="totp-code"
              className={styles.input}
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <div className={styles.actions}>
              <button type="submit" className={styles.action}>
                Turn on two-step
              </button>
              <button type="button" className={styles.action} onClick={() => setSetup(null)}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <>
            <p className={styles.hint}>
              Off. Turning it on asks for a code from an authenticator app whenever you sign in
              with your password. Passkeys skip this step, because they are already two factors.
            </p>
            <button type="button" className={styles.action} onClick={beginTwoStep}>
              Set up two-step sign in
            </button>
          </>
        )}

        {recoveryCodes && (
          <div className={styles.recovery} role="alert">
            <h4 className={styles.subheading}>Save these recovery codes</h4>
            <p className={styles.hint}>
              Each one signs you in once if you lose your phone. This is the only time they are
              shown.
            </p>
            <ul className={`${styles.codes} tnum`}>
              {recoveryCodes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <button
              type="button"
              className={styles.action}
              onClick={() => {
                void navigator.clipboard?.writeText(recoveryCodes.join("\n"));
                toast.success("Recovery codes copied.");
              }}
            >
              Copy them
            </button>
            <button
              type="button"
              className={styles.action}
              onClick={() => setRecoveryCodes(null)}
            >
              I have saved them
            </button>
          </div>
        )}
      </section>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

export type { Me };
