"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api, ApiError } from "@/lib/api";
import { AuthPanel } from "@/components/auth/auth-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const schema = z.object({ email: z.string().email("Enter a valid email address.") });
type Values = z.infer<typeof schema>;

const noteClass = "text-muted-foreground text-[13px] leading-5";
const errorClass = "text-alarm-ink text-[13px] leading-5";
const linkClass = "text-primary underline-offset-4 hover:underline";

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
    <AuthPanel>
      {sent ? (
        // The same message whatever the address was. Confirming that an
        // account exists here would undo the backend's own refusal to say.
        <div className="flex flex-col gap-4">
          <h2 className="text-[16px] font-semibold">Check your email</h2>
          <p className={noteClass}>
            If that email has an account, a reset link is on its way. The link works for one hour.
          </p>
          <p className={noteClass}>
            Nothing arrived? Check spam, then try again. Signing in with your current password
            cancels the request.
          </p>
          <Button variant="outline" asChild className="w-full">
            <Link href="/login">Back to sign in</Link>
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-[16px] font-semibold">Forgotten your password?</h2>
            <p className={noteClass}>
              Enter the email you signed up with and we will send a link to choose a new password.
            </p>
          </div>
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                aria-invalid={!!errors.email}
                aria-describedby={errors.email ? "email-error" : undefined}
                {...register("email")}
              />
              {errors.email && (
                <p id="email-error" className={errorClass} role="alert">
                  {errors.email.message}
                </p>
              )}
            </div>
            {error && (
              <p className={errorClass} role="alert">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              Send the link
            </Button>
          </form>
          <p className={`${noteClass} text-center`}>
            <Link href="/login" className={linkClass}>
              Back to sign in
            </Link>
          </p>
        </div>
      )}
    </AuthPanel>
  );
}
