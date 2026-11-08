"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { Mark } from "@/components/mark";
import styles from "../login/login.module.css";

const schema = z
  .object({
    password: z.string().min(8, "Use at least 8 characters."),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: "Those two passwords do not match.",
    path: ["confirm"],
  });
type Values = z.infer<typeof schema>;

function ResetForm() {
  const router = useRouter();
  const token = useSearchParams().get("token");
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema) });

  async function onSubmit(values: Values) {
    setError(null);
    try {
      await api.post("auth/reset-password", { token, password: values.password });
      // No automatic sign in. The reset bumped tokenVersion, so signing in
      // with the new password is both the confirmation and the next step.
      toast.success("Password changed. Sign in with your new password.");
      router.replace("/login");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reset the password.");
    }
  }

  if (!token) {
    return (
      <>
        <p className={styles.note}>
          That reset link is incomplete. Request a new one and open it directly from the email.
        </p>
        <Link href="/forgot-password" className={styles.provider}>
          Request a new link
        </Link>
      </>
    );
  }

  return (
    <>
      <p className={styles.note}>Choose a new password. This signs you out on every device.</p>
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <label className={styles.label} htmlFor="password">
          New password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="new-password"
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

        <label className={styles.label} htmlFor="confirm">
          Confirm new password
        </label>
        <input
          id="confirm"
          type="password"
          autoComplete="new-password"
          className={styles.input}
          aria-invalid={!!errors.confirm}
          aria-describedby={errors.confirm ? "confirm-error" : undefined}
          {...register("confirm")}
        />
        {errors.confirm && (
          <p id="confirm-error" className={styles.fieldError} role="alert">
            {errors.confirm.message}
          </p>
        )}

        {error && (
          <p className={styles.formError} role="alert">
            {error}
          </p>
        )}

        <button type="submit" className={styles.primary} disabled={isSubmitting}>
          Set new password
        </button>
      </form>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.brand}>
          <Mark size={28} />
          Study Tracker
        </h1>
        {/* useSearchParams opts this subtree into client rendering, so the
            boundary has to exist for the shell to prerender. */}
        <Suspense fallback={<p className={styles.note}>Checking that link.</p>}>
          <ResetForm />
        </Suspense>
      </div>
    </main>
  );
}
