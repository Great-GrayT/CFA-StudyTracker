"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { registerPasskey, isPasskeySupported } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";

// Passkeys and two-step sign in, rendered inside the Security section.
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

const SUB = "text-[16px] leading-tight font-semibold";
const HINT = "text-muted-foreground text-[13px] leading-relaxed";

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
    <>
      <div className="flex flex-col gap-3">
        <h3 className={SUB}>Passkeys</h3>
        <p className={HINT}>
          Sign in with your fingerprint, face, or device PIN instead of a password. A passkey cannot
          be phished, because it only works on this site.
        </p>

        {passkeys.length > 0 ? (
          <ul className="border-border flex flex-col border-t">
            {passkeys.map((p) => (
              <li
                key={p.id}
                className="border-border flex min-h-11 items-center justify-between gap-4 border-b py-2"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-[14px]">{p.label ?? "Passkey"}</span>
                  <span className="text-muted-foreground text-[12px] tabular-nums">
                    Added {new Date(p.createdAt).toLocaleDateString()}
                    {p.lastUsedAt
                      ? `, last used ${new Date(p.lastUsedAt).toLocaleDateString()}`
                      : ", not used yet"}
                    {p.backedUp ? ", synced" : ""}
                  </span>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="max-md:h-11"
                  onClick={() => removePasskey(p.id)}
                  aria-label={`Remove ${p.label ?? "this passkey"}`}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className={HINT}>No passkeys yet.</p>
        )}

        {supported ? (
          <div>
            <Button variant="outline" onClick={addPasskey}>
              Add a passkey
            </Button>
          </div>
        ) : (
          <p className={HINT}>This browser does not support passkeys.</p>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <h3 className={SUB}>Two-step sign in</h3>

        {enabled ? (
          <>
            <p className={HINT}>
              On. You are asked for a code from your authenticator app each time you sign in with
              your password.
            </p>
            {disabling ? (
              <form onSubmit={turnOff} className="flex max-w-sm flex-col gap-3">
                <p className={HINT}>
                  Confirm your password to turn it off. This also deletes your recovery codes.
                </p>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="disable-password">Password</Label>
                  <Input
                    id="disable-password"
                    type="password"
                    autoComplete="current-password"
                    value={disablePassword}
                    onChange={(e) => setDisablePassword(e.target.value)}
                    className="h-9 max-md:h-11"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" variant="destructive">
                    Turn off two-step
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setDisabling(false)}>
                    Keep it on
                  </Button>
                </div>
              </form>
            ) : (
              <div>
                <Button variant="outline" onClick={() => setDisabling(true)}>
                  Turn off two-step
                </Button>
              </div>
            )}
          </>
        ) : setup ? (
          <form onSubmit={confirmTwoStep} className="flex max-w-sm flex-col gap-3">
            <p className={HINT}>
              Scan this with your authenticator app, then enter the code it shows.
            </p>
            {/* The URI is text as well as a link: a QR image would mean a canvas
                dependency or fetching a picture of the secret from another server. */}
            <a
              className="text-primary text-[14px] underline underline-offset-4"
              href={setup.otpauthUri}
            >
              Open in your authenticator app
            </a>
            <p className={HINT}>
              Or type this key in by hand:{" "}
              <code className="text-foreground text-[13px] tabular-nums break-all">{setup.secret}</code>
            </p>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="totp-code">Code from the app</Label>
              <InputOTP id="totp-code" maxLength={6} value={code} onChange={setCode} inputMode="numeric" autoComplete="one-time-code">
                <InputOTPGroup>
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <InputOTPSlot key={i} index={i} className="size-11 text-[16px] tabular-nums md:size-9" />
                  ))}
                </InputOTPGroup>
              </InputOTP>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={code.length !== 6}>
                Turn on two-step
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setSetup(null);
                  setCode("");
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <>
            <p className={HINT}>
              Off. Turning it on asks for a code from an authenticator app whenever you sign in with
              your password. Passkeys skip this step, because they are already two factors.
            </p>
            <div>
              <Button variant="outline" onClick={beginTwoStep}>
                Set up two-step sign in
              </Button>
            </div>
          </>
        )}

        {recoveryCodes && (
          <div role="alert" className="border-border flex flex-col gap-3 border-l pl-4">
            <h4 className={SUB}>Save these recovery codes</h4>
            <p className={HINT}>
              Each one signs you in once if you lose your phone. This is the only time they are
              shown.
            </p>
            <ul className="grid grid-cols-2 gap-x-6 gap-y-1 text-[14px] tabular-nums">
              {recoveryCodes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  void navigator.clipboard?.writeText(recoveryCodes.join("\n"));
                  toast.success("Recovery codes copied.");
                }}
              >
                Copy them
              </Button>
              <Button variant="outline" onClick={() => setRecoveryCodes(null)}>
                I have saved them
              </Button>
            </div>
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="text-alarm-ink text-[13px]">
          {error}
        </p>
      )}
    </>
  );
}
