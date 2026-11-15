"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { AuthPanel } from "@/components/auth/auth-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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

const noteClass = "text-muted-foreground text-[13px] leading-5";
const errorClass = "text-alarm-ink text-[13px] leading-5";

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
      <div className="flex flex-col gap-4">
        <p className={noteClass}>
          That reset link is incomplete. Request a new one and open it directly from the email.
        </p>
        <Button variant="outline" asChild className="w-full">
          <Link href="/forgot-password">Request a new link</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className={noteClass}>Choose a new password. This signs you out on every device.</p>
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="password">New password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            aria-invalid={!!errors.password}
            aria-describedby={errors.password ? "password-error" : undefined}
            {...register("password")}
          />
          {errors.password && (
            <p id="password-error" className={errorClass} role="alert">
              {errors.password.message}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="confirm">Confirm new password</Label>
          <Input
            id="confirm"
            type="password"
            autoComplete="new-password"
            aria-invalid={!!errors.confirm}
            aria-describedby={errors.confirm ? "confirm-error" : undefined}
            {...register("confirm")}
          />
          {errors.confirm && (
            <p id="confirm-error" className={errorClass} role="alert">
              {errors.confirm.message}
            </p>
          )}
        </div>

        {error && (
          <p className={errorClass} role="alert">
            {error}
          </p>
        )}

        <Button type="submit" className="w-full" disabled={isSubmitting}>
          Set new password
        </Button>
      </form>
    </div>
  );
}

export default function ResetPasswordPage() {
  // useSearchParams opts this subtree into client rendering, so the boundary has
  // to exist for the shell to prerender.
  return (
    <AuthPanel>
      <Suspense fallback={<p className={noteClass}>Checking that link.</p>}>
        <ResetForm />
      </Suspense>
    </AuthPanel>
  );
}
