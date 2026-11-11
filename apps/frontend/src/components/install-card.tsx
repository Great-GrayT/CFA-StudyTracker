"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  isIOS,
  isInstalled,
  watchInstallability,
  type BeforeInstallPromptEvent,
} from "@/lib/install";
import styles from "./install-card.module.css";

/**
 * Install state as the interface needs to see it, which is not the same shape
 * the browser reports it in.
 *
 * `unavailable` renders nothing. A browser that cannot install the app and is
 * not iOS has no instruction worth giving, and a button that cannot work is
 * worse than no button.
 */
type State = "unknown" | "installed" | "ready" | "ios" | "unavailable";

/**
 * Sits directly above the notification controls, because on iOS installing is
 * not a convenience: an uninstalled app cannot receive a push at all, so the
 * notification button below this one is unreachable until this is done.
 */
export function InstallCard(): React.ReactElement | null {
  const [state, setState] = useState<State>("unknown");
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    if (isInstalled()) {
      setState("installed");
      return;
    }

    // Set before the listener so an iPhone, which never fires
    // beforeinstallprompt, still gets its instructions.
    setState(isIOS() ? "ios" : "unavailable");

    return watchInstallability({
      onAvailable: (event) => {
        setPrompt(event);
        setState("ready");
      },
      onInstalled: () => {
        setPrompt(null);
        setState("installed");
      },
    });
  }, []);

  async function handleInstall() {
    if (!prompt) return;
    setAsking(true);
    try {
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      if (outcome === "accepted") {
        // The browser fires appinstalled too, but not on every platform and
        // not always promptly, and the person has just watched the install
        // happen. Say so now.
        setState("installed");
        toast.success("Installed. Open it from your home screen.");
      }
    } catch {
      toast.error("The browser would not open the install prompt. Use its menu instead.");
    } finally {
      // Single use: the browser will not accept this event twice, so the
      // button must not offer a second attempt that silently does nothing.
      setPrompt(null);
      setAsking(false);
    }
  }

  if (state === "unknown" || state === "unavailable") return null;

  return (
    <section className={styles.section} aria-labelledby="install-heading">
      <h2 id="install-heading" className={styles.title}>
        Install on this phone
      </h2>

      {state === "installed" && (
        <p className={styles.line}>Installed on this device. Notifications can reach it.</p>
      )}

      {state === "ready" && (
        <>
          <p className={styles.line}>
            Install the app to open it from your home screen and receive notifications.
          </p>
          <button
            type="button"
            className={styles.action}
            onClick={handleInstall}
            disabled={asking}
          >
            Install
          </button>
        </>
      )}

      {state === "ios" && (
        <>
          <p className={styles.line}>
            iOS has no install button. Add the app from Safari instead, and do it before
            turning on notifications: iOS only sends them to an installed app.
          </p>
          {/* A genuine sequence, so it is numbered. The steps are named the
              way Safari names them, because a renamed step is a step the
              person cannot find. */}
          <ol className={styles.steps}>
            <li>Open this page in Safari.</li>
            <li>Tap the Share button in the toolbar.</li>
            <li>Choose Add to Home Screen.</li>
          </ol>
        </>
      )}
    </section>
  );
}
