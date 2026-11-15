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
import { AuthPanel } from "@/components/auth/auth-panel";
import { GoogleMark, GitHubMark } from "@/components/provider-marks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";

// Mirrors the backend's own zod shape, so the client rejects what the server
// would reject and the two messages never disagree.
const schema = z.object({
  email: z.string().email("Enter a valid email address."),
  password: z.string().min(8, "Use at least 8 characters."),
});
type Values = z.infer<typeof schema>;

const noteClass = "text-muted-foreground text-[13px] leading-5";
const errorClass = "text-alarm-ink text-[13px] leading-5";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<"login" | "register">("login");
  // Set once the password was right but the second step is outstanding.
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  // Recovery codes are longer than the six digit OTP slots, so they get a plain field.
  const [recovery, setRecovery] = useState(false);
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

  if (mfaToken) {
    return (
      <AuthPanel animatedMark>
        <form onSubmit={onCode} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-[16px] font-semibold">Two step check</h2>
            <p className={noteClass}>
              {recovery
                ? "Enter one of your recovery codes."
                : "Enter the six digit code from your authenticator app."}
            </p>
          </div>

          {recovery ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="code">Recovery code</Label>
              <Input
                id="code"
                autoComplete="one-time-code"
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Label htmlFor="code">Code</Label>
              <InputOTP
                id="code"
                maxLength={6}
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                value={code}
                onChange={setCode}
              >
                <InputOTPGroup>
                  {Array.from({ length: 6 }, (_, i) => (
                    <InputOTPSlot key={i} index={i} className="max-md:h-11 max-md:w-11" />
                  ))}
                </InputOTPGroup>
              </InputOTP>
            </div>
          )}

          {formError && (
            <p className={errorClass} role="alert">
              {formError}
            </p>
          )}

          <Button type="submit" className="w-full">
            Continue
          </Button>
          <div className="flex flex-wrap justify-between gap-2 text-[13px]">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setRecovery((on) => !on);
                setCode("");
                setFormError(null);
              }}
            >
              {recovery ? "Use an authenticator code" : "Use a recovery code"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setMfaToken(null);
                setCode("");
                setRecovery(false);
                setFormError(null);
              }}
            >
              Start again
            </Button>
          </div>
        </form>
      </AuthPanel>
    );
  }

  return (
    <AuthPanel animatedMark>
      <Tabs value={mode} onValueChange={(v) => setMode(v as "login" | "register")}>
        <TabsList className="grid h-9 w-full grid-cols-2 max-md:h-11">
          <TabsTrigger value="login">Sign in</TabsTrigger>
          <TabsTrigger value="register">Create account</TabsTrigger>
        </TabsList>

        <TabsContent value={mode} className="flex flex-col gap-4">
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

            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
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

            {formError && (
              <p className={errorClass} role="alert">
                {formError}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {mode === "login" ? "Sign in" : "Create account"}
            </Button>
          </form>

          <div className="flex items-center gap-3 text-[13px] text-muted-foreground">
            <Separator className="flex-1" />
            <span>or continue with</span>
            <Separator className="flex-1" />
          </div>

          {/* Full page navigations, not fetches: these are redirects to the
              provider and must leave the SPA. */}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" asChild>
              <a href="/api/oauth/google">
                <GoogleMark />
                Google
              </a>
            </Button>
            <Button variant="outline" asChild>
              <a href="/api/oauth/github">
                <GitHubMark />
                GitHub
              </a>
            </Button>
          </div>

          {passkeyReady && mode === "login" && (
            <Button type="button" variant="outline" className="w-full" onClick={onPasskey}>
              Use a passkey
            </Button>
          )}

          {mode === "login" && (
            <p className={`${noteClass} text-center`}>
              <Link href="/forgot-password" className="text-primary underline-offset-4 hover:underline">
                Forgotten your password?
              </Link>
            </p>
          )}
        </TabsContent>
      </Tabs>
    </AuthPanel>
  );
}

// useSearchParams opts the subtree into client rendering, so the boundary has
// to exist for the shell around it to prerender. The fallback is the same panel
// without the OAuth error line, which is the only part that needs the query.
// The fallback renders the real panel, not an empty shell, because it is what
// the server sends and an empty one leaves a blank page while hydration waits.
export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <AuthPanel>
          <p className={noteClass}>Loading sign in.</p>
        </AuthPanel>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
