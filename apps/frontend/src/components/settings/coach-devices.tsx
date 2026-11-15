"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { usePushDevices } from "@/lib/hooks";
import { api, ApiError } from "@/lib/api";
import {
  isPushSupported,
  getExistingSubscription,
  subscribeToPush,
  unsubscribeFromPush,
  getPermission,
} from "@/lib/push";
import { getVapidPublicKey } from "@/lib/vapid";
import type { Plan } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { OfflineLine, RegionError, regionState } from "@/components/states/region-states";
import { useOnline } from "@/hooks/use-online";
import { CoachSettings } from "@/components/coach-settings";
import { InstallCard } from "@/components/install-card";
import { SettingsSection } from "./section";

const HINT = "text-muted-foreground text-[13px] leading-relaxed";

export function CoachDevicesSection({
  plan,
  planLoading,
  onSaved,
}: {
  plan: Plan | undefined;
  planLoading: boolean;
  onSaved: () => void;
}) {
  return (
    <SettingsSection
      id="coach"
      title="Coach and devices"
      lede="What the coach sends and when, and which devices receive it."
    >
      {planLoading && !plan ? (
        <Skeleton className="h-24 w-full rounded-none" />
      ) : plan ? (
        <CoachSettings plan={plan} onSaved={onSaved} />
      ) : (
        // Rendered rather than omitted: with no plan there is nothing to set yet,
        // but an absent section reads as a missing feature.
        <p className={HINT}>
          The coach writes you a plan each morning, a nudge in the evening, and a summary at night.
          Its settings live with your study plan, so they appear here once you have one.{" "}
          <Link href="/onboarding" className="text-primary underline underline-offset-4">
            Create a plan
          </Link>{" "}
          to turn it on.
        </p>
      )}

      {/* Above the devices on purpose: on iOS an uninstalled app cannot receive a
          push at all, so the device controls do nothing until this is done. */}
      <InstallCard />

      <Devices />
    </SettingsSection>
  );
}

// Two rows in the same shape as a device row, so the list does not jump on load.
function DevicesSkeleton() {
  return (
    <ul className="border-border flex flex-col border-t" aria-hidden="true">
      {[0, 1].map((i) => (
        <li key={i} className="border-border flex min-h-11 items-center justify-between gap-4 border-b py-2">
          <span className="flex flex-col gap-1.5">
            <Skeleton className="h-4 w-40 rounded-sm" />
            <Skeleton className="h-3 w-24 rounded-sm" />
          </span>
          <Skeleton className="h-8 w-16 rounded-sm" />
        </li>
      ))}
    </ul>
  );
}

function Devices() {
  const pushDevices = usePushDevices();
  const online = useOnline();
  const { loading: devicesLoading, error: devicesError } = regionState(pushDevices);
  const [supported, setSupported] = useState(false);
  const [currentSubscription, setCurrentSubscription] = useState<PushSubscription | null>(null);
  const [subscribing, setSubscribing] = useState(false);
  const [unsubscribing, setUnsubscribing] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [iosNotInstalled, setIosNotInstalled] = useState(false);
  const [testing, setTesting] = useState<"email" | "push" | null>(null);

  // After mount: isPushSupported reads the browser, which the server does not have.
  useEffect(() => {
    const ok = isPushSupported();
    setSupported(ok);
    if (ok) void getExistingSubscription().then(setCurrentSubscription);
  }, []);

  async function handleAddDevice() {
    setPermissionDenied(false);
    setIosNotInstalled(false);

    if (!isPushSupported()) {
      setIosNotInstalled(true);
      return;
    }

    const permission = await getPermission();
    if (permission === "denied") {
      setPermissionDenied(true);
      return;
    }

    setSubscribing(true);
    try {
      const vapidKey = getVapidPublicKey();
      if (!vapidKey) throw new Error("Push not configured.");
      await subscribeToPush(vapidKey);
      setCurrentSubscription(await getExistingSubscription());
      toast.success("Device added. You will get notifications.");
      pushDevices.refetch?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to subscribe.";
      if (msg.includes("permission")) setPermissionDenied(true);
      else toast.error(msg);
    } finally {
      setSubscribing(false);
    }
  }

  async function handleRemoveDevice(endpoint: string) {
    setUnsubscribing(endpoint);
    try {
      if (endpoint === currentSubscription?.endpoint) {
        await unsubscribeFromPush();
        setCurrentSubscription(null);
      } else {
        await api.del<void>("push/subscribe", { endpoint });
      }
      toast.success("Device removed.");
      pushDevices.refetch?.();
    } catch {
      toast.error("Failed to remove device.");
    } finally {
      setUnsubscribing(null);
    }
  }

  // The coach speaks at fixed local times, so without these there is no way to
  // tell a working channel from a silent one until one of those times comes round.
  async function handleTest(channel: "email" | "push") {
    setTesting(channel);
    try {
      const res = await api.post<{ ok: boolean; to?: string; devices?: number }>("coach/test", { channel });
      toast.success(
        channel === "email"
          ? `Sent to ${res.to ?? "your address"}. If it does not arrive, check spam.`
          : "Sent. It should appear on every device you have added.",
      );
    } catch (err) {
      // The route reports WHY rather than failing blank: no SMTP, no device
      // registered, or the send itself refused.
      toast.error(err instanceof ApiError ? err.message : "Could not send.");
    } finally {
      setTesting(null);
    }
  }

  if (!supported) {
    return <p className={HINT}>This browser cannot receive phone notifications.</p>;
  }

  const devices = pushDevices.data?.subscriptions ?? [];
  const showDevices = !devicesLoading && !devicesError && devices.length > 0;

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-[14px] font-medium">Devices</h3>
      <p className={HINT}>
        Phone notifications go to every device you have added. Each one shows the name it was given.
      </p>

      {devicesLoading && <DevicesSkeleton />}

      {!devicesLoading && !!devicesError && (
        <RegionError error={devicesError} online={online} onRetry={() => void pushDevices.refetch()} />
      )}

      {showDevices && !online && <OfflineLine />}

      {showDevices && (
        <ul className="border-border flex flex-col border-t">
          {devices.map((device) => {
            const isThisDevice = currentSubscription?.endpoint === device.endpoint;
            const name = device.label ?? "Unnamed device";
            return (
              <li
                key={device.id}
                className="border-border flex min-h-11 items-center justify-between gap-4 border-b py-2"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="flex items-center gap-2 text-[14px]">
                    <span className="truncate">{name}</span>
                    {isThisDevice && (
                      <span className="border-primary text-primary shrink-0 border px-1.5 text-[12px] leading-5 rounded-sm">
                        This device
                      </span>
                    )}
                  </span>
                  <span className="text-muted-foreground text-[12px] tabular-nums">
                    Added {new Date(device.createdAt).toLocaleDateString()}
                  </span>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="max-md:h-11"
                  onClick={() => handleRemoveDevice(device.endpoint)}
                  disabled={unsubscribing === device.endpoint}
                  aria-label={`Remove ${isThisDevice ? "this device" : name}`}
                >
                  Remove
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      {permissionDenied && (
        <p role="alert" className="text-alarm-ink text-[13px]">
          Notifications are blocked for this site. Your browser settings control that.
        </p>
      )}

      {iosNotInstalled && (
        <p role="alert" className="text-alarm-ink text-[13px]">
          Add this app to your home screen first. iOS only allows notifications for installed apps.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={handleAddDevice} disabled={subscribing || !!currentSubscription}>
          {currentSubscription ? "Added" : "Add this device"}
        </Button>
        <Button variant="ghost" onClick={() => handleTest("email")} disabled={testing !== null}>
          {testing === "email" ? "Sending" : "Send a test email"}
        </Button>
        <Button
          variant="ghost"
          onClick={() => handleTest("push")}
          disabled={testing !== null || !currentSubscription}
        >
          {testing === "push" ? "Sending" : "Send a test notification"}
        </Button>
      </div>
    </div>
  );
}
