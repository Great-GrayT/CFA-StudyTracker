"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import {
  isIOS,
  isInstalled,
  watchInstallability,
  type BeforeInstallPromptEvent,
} from "@/lib/install";
import { Icon, type IconName } from "./icons";
import styles from "./utility-strip.module.css";

/**
 * Theme and install, as icons in the navigation rather than rows inside
 * Settings.
 *
 * Both are things people reach for at a moment, not settings they sit down to
 * configure: the theme because the room got dark, and install because they
 * just decided they want the app on their home screen. Buried three taps deep
 * in Settings, install in particular was never going to be found, which is
 * part of why nobody had the app installed.
 */

const THEMES = ["system", "light", "dark"] as const;
type ThemeName = (typeof THEMES)[number];

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none">
      <circle cx="12" cy="12" r="4.5" stroke="currentColor" strokeWidth="2" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
        <line
          key={a}
          x1="12"
          y1="2.5"
          x2="12"
          y2="5"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          transform={`rotate(${a} 12 12)`}
        />
      ))}
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none">
      <path
        d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SystemIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none">
      <rect x="3" y="4" width="18" height="13" rx="1.5" stroke="currentColor" strokeWidth="2" />
      <line x1="8" y1="20" x2="16" y2="20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function InstallIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none">
      <rect x="6" y="2.5" width="12" height="19" rx="2.5" stroke="currentColor" strokeWidth="2" />
      <path
        d="M12 8v6m0 0 2.5-2.5M12 14l-2.5-2.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const THEME_ICON = { system: SystemIcon, light: SunIcon, dark: MoonIcon };
const THEME_LABEL = {
  system: "Theme: following your device",
  light: "Theme: light",
  dark: "Theme: dark",
};

/**
 * The pages that need a permanent way in but do not earn one of the five
 * slots in the bottom bar.
 *
 * They used to be the sixth slot, which is what stopped the compose button
 * from sitting on the centre line. Moving them up here is not just tidying:
 * /settings, /logs and /mocks were once reachable only by typing the URL,
 * and dropping them from the bar without a new home would put them straight
 * back there.
 */
const SECONDARY: ReadonlyArray<{ href: string; label: string; icon: IconName }> = [
  { href: "/logs", label: "Study log", icon: "Logged" },
  { href: "/mocks", label: "Mock exams", icon: "Mock" },
  { href: "/watchdogs", label: "Watchdogs", icon: "Health" },
  { href: "/settings", label: "Settings", icon: "Settings" },
];

export function UtilityStrip({
  className,
  secondary = false,
}: {
  className?: string;
  /** Carry the secondary pages too. The phone strip does; the rail has its
      own list and would otherwise show them twice. */
  secondary?: boolean;
}) {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installState, setInstallState] = useState<"none" | "ready" | "ios" | "installed">("none");

  useEffect(() => {
    // The theme is unknown until the client has read it, and rendering a sun
    // on the server that becomes a moon on the client is a hydration
    // mismatch React discards the tree over.
    setMounted(true);

    if (isInstalled()) {
      setInstallState("installed");
      return;
    }
    if (isIOS()) setInstallState("ios");

    return watchInstallability({
      onAvailable: (event) => {
        setInstallPrompt(event);
        setInstallState("ready");
      },
      onInstalled: () => {
        setInstallPrompt(null);
        setInstallState("installed");
      },
    });
  }, []);

  const current = (THEMES.includes(theme as ThemeName) ? theme : "system") as ThemeName;
  const ThemeIcon = THEME_ICON[current];

  function cycleTheme() {
    const next = THEMES[(THEMES.indexOf(current) + 1) % THEMES.length];
    setTheme(next);
  }

  async function handleInstall() {
    if (installState === "ios") {
      toast("iOS has no install button.", {
        description: "In Safari, open Share, then Add to Home Screen.",
        duration: 8000,
      });
      return;
    }
    if (!installPrompt) return;
    try {
      await installPrompt.prompt();
      const { outcome } = await installPrompt.userChoice;
      if (outcome === "accepted") {
        setInstallState("installed");
        toast.success("Installed. Open it from your home screen.");
      }
    } catch {
      toast.error("The browser would not open the install prompt. Use its menu instead.");
    } finally {
      // Single use: the browser will not replay this event, so the button
      // must not offer a second attempt that silently does nothing.
      setInstallPrompt(null);
    }
  }

  if (!mounted) {
    // Reserves the space so the bar does not shift when the icons arrive.
    return <div className={`${styles.strip} ${className ?? ""}`} aria-hidden="true" />;
  }

  const showInstall = installState === "ready" || installState === "ios";

  return (
    <div className={`${styles.strip} ${className ?? ""}`}>
      {secondary
        ? SECONDARY.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={styles.button}
              aria-current={pathname.startsWith(item.href) ? "page" : undefined}
              aria-label={item.label}
              title={item.label}
            >
              <Icon name={item.icon} size={18} />
            </Link>
          ))
        : null}

      <button
        type="button"
        className={styles.button}
        onClick={cycleTheme}
        aria-label={`${THEME_LABEL[current]}. Change it.`}
        title={THEME_LABEL[current]}
      >
        <ThemeIcon />
      </button>

      {showInstall ? (
        <button
          type="button"
          // Pulses like a notification until it is used: this is the one
          // control in the app that people want and never go looking for.
          className={`${styles.button} ${styles.pulse}`}
          onClick={handleInstall}
          aria-label="Install this app on your phone"
          title="Install this app"
        >
          <InstallIcon />
          <span className={styles.dot} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
