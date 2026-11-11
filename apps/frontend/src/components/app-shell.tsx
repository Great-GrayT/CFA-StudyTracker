"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Mark } from "./mark";
import { Icon, type IconName } from "./icons";
import { UtilityStrip } from "./utility-strip";
import styles from "./app-shell.module.css";

// The composer sits IN the bar rather than floating above content: a floating
// action button covers the last list row on a phone, and the bottom centre is
// the easiest place to reach one-handed.
//
// Everything with a page needs a way in. /settings, /logs and /mocks were all
// built, shipped and referenced from nowhere at all, so the only way to reach
// any of them was to type the URL. A page nothing links to does not exist as
// far as a user is concerned.
const NAV = [
  { href: "/today", label: "Today", icon: "Today" },
  { href: "/coverage", label: "Coverage", icon: "Coverage" },
  { href: "/pace", label: "Pace", icon: "Pace" },
  { href: "/plan", label: "Plan", icon: "Plan" },
] as const satisfies ReadonlyArray<{ href: string; label: string; icon: IconName }>;

// Reached often enough to need a permanent home, not often enough to compete
// with the four above for the bottom bar's five slots. Kept visually quieter in
// the rail rather than hidden behind a menu, since a utility nobody can find is
// the problem being fixed, not the pattern to copy.
const SECONDARY = [
  { href: "/logs", label: "Study log", icon: "Logged" },
  { href: "/mocks", label: "Mock exams", icon: "Mock" },
  { href: "/watchdogs", label: "Watchdogs", icon: "Health" },
  { href: "/settings", label: "Settings", icon: "Settings" },
] as const satisfies ReadonlyArray<{ href: string; label: string; icon: IconName }>;

export function AppShell({
  children,
  onCompose,
}: {
  children: React.ReactNode;
  onCompose?: () => void;
}) {
  const pathname = usePathname();

  return (
    <div className={styles.shell}>
      <nav className={styles.rail} aria-label="Main">
        <Link href="/today" className={styles.brand} aria-label="Study Tracker home">
          <Mark size={24} />
          <span className={styles.brandName}>Study Tracker</span>
        </Link>
        <ul className={styles.railList}>
          {NAV.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className={styles.railLink}
                aria-current={pathname.startsWith(item.href) ? "page" : undefined}
              >
                <Icon name={item.icon} size={18} />
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
        <button type="button" className={styles.railCompose} onClick={onCompose}>
          <Icon name="Compose" size={18} />
          Log a session
        </button>
        <UtilityStrip className={styles.railUtility} />
        <ul className={styles.railSecondary}>
          {SECONDARY.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className={styles.railSecondaryLink}
                aria-current={pathname.startsWith(item.href) ? "page" : undefined}
              >
                <Icon name={item.icon} size={16} />
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {/* On a phone the bottom bar is already full at six slots, and a
          seventh would put every touch target under the 44px floor, so the
          utilities sit top right instead. The rail carries its own copy. */}
      <UtilityStrip className={styles.topUtility} />

      <main className={styles.main} id="main">
        {children}
      </main>

      <nav className={styles.bar} aria-label="Main">
        {NAV.slice(0, 2).map((item) => (
          <BarLink
            key={item.href}
            href={item.href}
            label={item.label}
            icon={item.icon}
            pathname={pathname}
          />
        ))}
        <button
          type="button"
          className={styles.compose}
          onClick={onCompose}
          aria-label="Log a session"
          title="Log a session"
        >
          <span aria-hidden="true" className={styles.composeGlyph} />
        </button>
        {NAV.slice(2).map((item) => (
          <BarLink
            key={item.href}
            href={item.href}
            label={item.label}
            icon={item.icon}
            pathname={pathname}
          />
        ))}
        <BarLink href="/settings" label="Settings" icon="Settings" pathname={pathname} />
      </nav>
    </div>
  );
}

/**
 * Icon only, with the word as its tooltip and its accessible name.
 *
 * Worth knowing: a tooltip needs a pointer, and this bar is the phone one, so
 * on a touch screen the word is reachable by a screen reader but not by eye.
 * The icons therefore have to carry the meaning on their own, which is why
 * they are drawn on the same grid as the rest and the active one is marked by
 * colour AND a rule rather than colour alone.
 */
function BarLink({
  href,
  label,
  icon,
  pathname,
}: {
  href: string;
  label: string;
  icon: IconName;
  pathname: string;
}) {
  const active = pathname.startsWith(href);
  return (
    <Link
      href={href}
      className={styles.barLink}
      aria-current={active ? "page" : undefined}
      aria-label={label}
      title={label}
    >
      <Icon name={icon} size={20} />
    </Link>
  );
}
