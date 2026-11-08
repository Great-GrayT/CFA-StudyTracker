"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { signIn, ApiError } from "@/lib/api";
import {
  signInWithPasskey,
  completeTwoStep,
  isPasskeySupported,
} from "@/lib/auth-client";
import { Mark } from "@/components/mark";
import { Mark3DLazy } from "@/components/mark-3d-lazy";
import { GoogleMark, GitHubMark } from "@/components/provider-marks";
import styles from "./login.module.css";

// Mirrors the backend's own zod shape, so the client rejects what the server
// would reject and the two messages never disagree.
const schema = z.object({
  email: z.string().email("Enter a valid email address."),
  password: z.string().min(8, "Use at least 8 characters."),
});
type Values = z.infer<typeof schema>;

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<"login" | "register">("login");
  // Set once the password was right but the second step is outstanding.
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [passkeyReady, setPasskeyReady] = useState(false);

  useEffect(() => {
    setPasskeyReady(isPasskeySupported());
  }, []);
  const [formError, setFormError] = useState<string | null>(
    params.get("oauth") ? "That sign in did not complete. Try again." : null,
  );

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema) });

  async function onSubmit(values: Values) {
    setFormError(null);
    try {
      const outcome = await signIn(values.email, values.password, mode);
      if ("mfaRequired" in outcome) {
        setMfaToken(outcome.mfaToken);
        return;
      }
      router.replace("/");
      router.refresh();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Something went wrong.");
    }
  }

  async function onPasskey() {
    setFormError(null);
    try {
      await signInWithPasskey();
      router.replace("/");
      router.refresh();
    } catch (err) {
      // A cancelled dialog is a choice, not a failure, so it gets no error.
      if (err instanceof DOMException && err.name === "NotAllowedError") return;
      setFormError(err instanceof ApiError ? err.message : "That passkey did not work.");
    }
  }

  async function onCode(e: React.FormEvent) {
    e.preventDefault();
    if (!mfaToken) return;
    setFormError(null);
    try {
      await completeTwoStep(mfaToken, code);
      router.replace("/");
      router.refresh();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "That code is not right.");
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.brand}>
          <Mark3DLazy size={56} interactive />
          Study Tracker
        </h1>

        {mfaToken ? (
          <form onSubmit={onCode}>
            <p className={styles.note}>
              Enter the six digit code from your authenticator app, or one of your recovery codes.
            </p>
            <label className={styles.label} htmlFor="code">
              Code
            </label>
            <input
              id="code"
              className={styles.input}
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            {formError && (
              <p className={styles.formError} role="alert">
                {formError}
              </p>
            )}
            <button type="submit" className={styles.primary}>
              Continue
            </button>
            <p className={styles.divider}>
              <button
                type="button"
                className={styles.linkButton}
                onClick={() => {
                  setMfaToken(null);
                  setCode("");
                  setFormError(null);
                }}
              >
                Start again
              </button>
            </p>
          </form>
        ) : (
        <>
        <div className={styles.segmented} role="tablist" aria-label="Sign in or create an account">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "login"}
            className={mode === "login" ? styles.segOn : styles.seg}
            onClick={() => setMode("login")}
          >
            Sign in
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "register"}
            className={mode === "register" ? styles.segOn : styles.seg}
            onClick={() => setMode("register")}
          >
            Create
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} noValidate>
          <label className={styles.label} htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            className={styles.input}
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? "email-error" : undefined}
            {...register("email")}
          />
          {errors.email && (
            <p id="email-error" className={styles.fieldError} role="alert">
              {errors.email.message}
            </p>
          )}

          <label className={styles.label} htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            className={styles.input}
            aria-invalid={!!errors.password}
            aria-describedby={errors.password ? "password-error" : undefined}
            {...register("password")}
          />
          {errors.password && (
            <p id="password-error" className={styles.fieldError} role="alert">
              {errors.password.message}
            </p>
          )}

          {formError && (
            <p className={styles.formError} role="alert">
              {formError}
            </p>
          )}

          <button type="submit" className={styles.primary} disabled={isSubmitting}>
            {mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>

        <p className={styles.divider}>or continue with</p>
        <div className={styles.providers}>
          {/* Full page navigations, not fetches: these are redirects to the
              provider and must leave the SPA. */}
          <a className={styles.provider} href="/api/oauth/google">
            <GoogleMark />
            Google
          </a>
          <a className={styles.provider} href="/api/oauth/github">
            <GitHubMark />
            GitHub
          </a>
        </div>

        {passkeyReady && mode === "login" && (
          <button type="button" className={styles.passkey} onClick={onPasskey}>
            Use a passkey
          </button>
        )}

        {mode === "login" && (
          <p className={styles.note}>
            <Link href="/forgot-password">Forgotten your password?</Link>
          </p>
        )}
        </>
        )}
      </div>
    </main>
  );
}

// useSearchParams opts the subtree into client rendering, so the boundary has
// to exist for the shell around it to prerender. The fallback is the same card
// without the OAuth error line, which is the only part that needs the query.
// The fallback renders the real card, not an empty shell. The fallback is
// what the server sends, so an empty one leaves the user staring at a blank
// page whenever hydration is delayed or blocked.
export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className={styles.page}>
          <div className={styles.card}>
            <h1 className={styles.brand}>
              <Mark size={28} />
              Study Tracker
            </h1>
            <p className={styles.note}>Loading sign in.</p>
          </div>
        </main>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
