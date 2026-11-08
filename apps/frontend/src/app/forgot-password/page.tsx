"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api, ApiError } from "@/lib/api";
import { Mark } from "@/components/mark";
import styles from "../login/login.module.css";

const schema = z.object({ email: z.string().email("Enter a valid email address.") });
type Values = z.infer<typeof schema>;

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema) });

  async function onSubmit(values: Values) {
    setError(null);
    try {
      await api.post("auth/forgot-password", { email: values.email });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send that.");
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.brand}>
          <Mark size={28} />
          Study Tracker
        </h1>

        {sent ? (
          // The same message whatever the address was. Confirming that an
          // account exists here would undo the backend's own refusal to say.
          <>
            <p className={styles.note}>
              If that email has an account, a reset link is on its way. The link works for one
              hour.
            </p>
            <p className={styles.note}>
              Nothing arrived? Check spam, then try again. Signing in with your current password
              cancels the request.
            </p>
            <Link href="/login" className={styles.provider}>
              Back to sign in
            </Link>
          </>
        ) : (
          <>
            <p className={styles.note}>
              Enter the email you signed up with and we will send a link to choose a new password.
            </p>
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
              {error && (
                <p className={styles.formError} role="alert">
                  {error}
                </p>
              )}
              <button type="submit" className={styles.primary} disabled={isSubmitting}>
                Send the link
              </button>
            </form>
            <p className={styles.divider}>
              <Link href="/login">Back to sign in</Link>
            </p>
          </>
        )}
      </div>
    </main>
  );
}
