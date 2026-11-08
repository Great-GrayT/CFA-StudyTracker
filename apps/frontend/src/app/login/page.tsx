"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { signIn, ApiError } from "@/lib/api";
import { Mark } from "@/components/mark";
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
      await signIn(values.email, values.password, mode);
      router.replace("/");
      router.refresh();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Something went wrong.");
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.brand}>
          <Mark size={28} />
          Study Tracker
        </h1>

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
            Google
          </a>
          <a className={styles.provider} href="/api/oauth/github">
            GitHub
          </a>
        </div>

        {/* Stated rather than hidden: /api/auth/forgot-password has a
            rate-limit tier in the backend's middleware and no route behind it,
            so offering a link here would be a dead end. */}
        <p className={styles.note}>
          Password recovery is not available yet. Keep your password somewhere safe.
        </p>
      </div>
    </main>
  );
}

// useSearchParams opts the subtree into client rendering, so the boundary has
// to exist for the shell around it to prerender. The fallback is the same card
// without the OAuth error line, which is the only part that needs the query.
export default function LoginPage() {
  return (
    <Suspense fallback={<main className={styles.page} />}>
      <LoginForm />
    </Suspense>
  );
}
