"use client";

import { useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useSignOut } from "@/components/shell/shell-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

// Deleting an account, from the Danger zone.
//
// Three decisions shaped this.
//
// It sits behind a Dialog. An irreversible action should not be one misclick
// from the surface of a settings page, and a dialog costs the person who really
// wants it one click.
//
// It counts out loud what will be destroyed. "This cannot be undone" is a phrase
// people have learned to click past; "this erases 47 logged sessions and 3 mock
// exams" is a specific loss, and specificity is what makes someone stop and read.
//
// It asks for two different things. The credential proves it is them, which a
// live session on an unlocked laptop does not. The typed phrase proves they
// meant it. Neither substitutes for the other, so the server requires both and
// so does this form.

const PHRASE = "delete my account";
const HINT = "text-muted-foreground text-[13px] leading-relaxed";

export function DeleteAccount({
  hasPassword,
  twoStepEnabled,
  counts,
}: {
  hasPassword: boolean;
  twoStepEnabled: boolean;
  counts: { logCount: number; mockCount: number; historyDays: number } | null;
}) {
  const signOut = useSignOut();
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

  function reset() {
    setCredential("");
    setConfirmation("");
  }

  async function handleDelete() {
    setPending(true);
    try {
      const body: Record<string, string> = { confirmation };
      if (credentialKind === "password") body.password = credential;
      // A six digit string is an authenticator code; anything else is a recovery
      // code, which is how the sign-in screen reads them too.
      if (credentialKind === "code") {
        const trimmed = credential.trim();
        if (/^\d{6}$/.test(trimmed)) body.totpCode = trimmed;
        else body.recoveryCode = trimmed;
      }

      await api.post("auth/account/delete", body);
      toast.success("Your account and everything in it has been deleted.");
      // The shell hook also clears the persisted cache, so the deleted account's
      // plan does not survive in this browser.
      await signOut();
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
    <div className="flex flex-col gap-3">
      <p className={HINT}>
        This removes your account and every piece of work in it from the database. There is no copy
        kept and no way back. Export your data first if you might want it.
      </p>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) reset();
        }}
      >
        <DialogTrigger asChild>
          <Button variant="destructive">Delete my account</Button>
        </DialogTrigger>

        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>
              {counts
                ? `You are about to destroy ${counts.logCount} logged ${counts.logCount === 1 ? "session" : "sessions"}, ${counts.mockCount} mock ${counts.mockCount === 1 ? "exam" : "exams"} and ${counts.historyDays} ${counts.historyDays === 1 ? "day" : "days"} of history, along with your plan and your sign-in.`
                : "This removes your plan, your record and your sign-in."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            {credentialKind !== "none" && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="delete-credential">
                  {credentialKind === "password"
                    ? "Your password"
                    : "A code from your authenticator, or a recovery code"}
                </Label>
                <Input
                  id="delete-credential"
                  type={credentialKind === "password" ? "password" : "text"}
                  autoComplete={credentialKind === "password" ? "current-password" : "one-time-code"}
                  value={credential}
                  disabled={pending}
                  onChange={(event) => setCredential(event.target.value)}
                  className="h-9 max-md:h-11"
                />
              </div>
            )}

            {credentialKind === "none" && (
              <p className={HINT}>
                You sign in with a connected account and have no password or second step set, so the
                phrase below is the only confirmation we can ask for.
              </p>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="delete-confirmation">
                Type <span className="font-medium">{PHRASE}</span> to confirm
              </Label>
              <Input
                id="delete-confirmation"
                type="text"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                aria-describedby="delete-confirmation-help"
                value={confirmation}
                disabled={pending}
                onChange={(event) => setConfirmation(event.target.value)}
                className="h-9 max-md:h-11"
              />
              <p id="delete-confirmation-help" className={HINT}>
                {confirmation.length === 0
                  ? "Exactly as written, in lower case."
                  : phraseMatches
                    ? "That matches."
                    : "That does not match yet."}
              </p>
            </div>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={pending}>
                Keep my account
              </Button>
            </DialogClose>
            <Button
              variant="destructive"
              disabled={pending || !phraseMatches || !credentialGiven}
              onClick={handleDelete}
            >
              {pending ? "Deleting" : "Delete account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
