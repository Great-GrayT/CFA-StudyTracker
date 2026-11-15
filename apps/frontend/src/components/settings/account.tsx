"use client";

import { useState } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useSignOut } from "@/components/shell/shell-actions";
import { RegionError, regionState } from "@/components/states/region-states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useOnline } from "@/hooks/use-online";
import { SettingsSection } from "./section";

export type Me = { id?: string; email: string; twoStepEnabled?: boolean; hasPassword?: boolean };

export function AccountSection({ query }: { query: UseQueryResult<Me> }) {
  const online = useOnline();
  const signOut = useSignOut();
  const { loading, error } = regionState(query);
  const user = query.data;
  const [changing, setChanging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  function closeForm() {
    setChanging(false);
    setFormError(null);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
  }

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (newPassword.length < 8) return setFormError("Use at least 8 characters.");
    if (newPassword !== confirmPassword) return setFormError("New passwords do not match.");
    if (!currentPassword) return setFormError("Enter your current password.");

    setSaving(true);
    try {
      await api.post<void>("auth/password", { currentPassword, newPassword });
      toast.success("Password changed. Signing out on all devices.");
      closeForm();
      // Through the shell hook, so the persisted cache of this account goes too.
      await signOut();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to change password.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSignOut() {
    setSigningOut(true);
    await signOut();
  }

  const fieldClass = "h-9 max-md:h-11";

  return (
    <SettingsSection id="account" title="Account">
      {loading ? (
        <Skeleton className="h-5 w-56 rounded-sm" />
      ) : error ? (
        <RegionError error={error} online={online} onRetry={() => query.refetch()} />
      ) : user ? (
        <>
          <p className="text-[14px] break-all">{user.email}</p>

          {!changing ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setChanging(true)}>
                Change password
              </Button>
              <Button variant="outline" disabled={signingOut} onClick={handleSignOut}>
                {signingOut ? "Signing out" : "Sign out"}
              </Button>
            </div>
          ) : (
            <form onSubmit={handlePasswordChange} className="flex max-w-sm flex-col gap-4">
              <p className="text-muted-foreground text-[13px]">
                Changing your password signs you out on every device. You will need to sign in
                again.
              </p>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="current-password">Current password</Label>
                <Input
                  id="current-password"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                  className={fieldClass}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="new-password">New password</Label>
                <Input
                  id="new-password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  className={fieldClass}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="confirm-password">Confirm password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  className={fieldClass}
                />
              </div>
              {formError && (
                <p role="alert" className="text-alarm-ink text-[13px]">
                  {formError}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={saving}>
                  {saving ? "Saving" : "Save changes"}
                </Button>
                <Button type="button" variant="outline" disabled={saving} onClick={closeForm}>
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </>
      ) : null}
    </SettingsSection>
  );
}
