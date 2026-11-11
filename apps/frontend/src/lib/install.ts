// Home screen install: detecting whether this app can be installed here,
// whether it already is, and holding the one chance the browser gives us to
// ask.
//
// No React, same convention as push.ts, so the state machine can be reasoned
// about and tested without a component around it.

/**
 * The event Chromium fires when the app meets the installability criteria.
 * Not in lib.dom yet, so it is declared here rather than cast away at the
 * call site.
 */
export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/**
 * True when the page is running as an installed app rather than in a browser
 * tab.
 *
 * Two checks, because the standards-track one does not cover iOS: Safari
 * never implemented `display-mode: standalone` for home screen apps and
 * reports `navigator.standalone` instead. Getting this wrong on iOS is the
 * expensive case, since it is exactly where install is a precondition for
 * notifications.
 */
export function isInstalled(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/**
 * True on an iOS browser, where every engine is WebKit.
 *
 * iPadOS reports itself as a Mac, so the touch-point check is what keeps an
 * iPad from being told it is a desktop. A Mac with a trackpad reports 0.
 */
export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  if (/iPad|iPhone|iPod/.test(navigator.userAgent)) return true;
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

/**
 * Subscribes to the install opportunity and returns the unsubscribe.
 *
 * `beforeinstallprompt` fires once, early, and is lost unless its default is
 * prevented and the event kept. Calling `prompt()` on an event that was
 * allowed to proceed throws, which is why the listener has to be installed
 * before the first paint rather than when a button is clicked.
 *
 * `appinstalled` is the only reliable signal on Chrome Android that the app
 * went in, because the install can also be started from the browser's own
 * menu, where no code of ours runs.
 */
export function watchInstallability(handlers: {
  onAvailable: (event: BeforeInstallPromptEvent) => void;
  onInstalled: () => void;
}): () => void {
  if (typeof window === "undefined") return () => {};

  const onBeforeInstallPrompt = (event: Event) => {
    event.preventDefault();
    handlers.onAvailable(event as BeforeInstallPromptEvent);
  };
  const onAppInstalled = () => handlers.onInstalled();

  window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  window.addEventListener("appinstalled", onAppInstalled);

  return () => {
    window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.removeEventListener("appinstalled", onAppInstalled);
  };
}
