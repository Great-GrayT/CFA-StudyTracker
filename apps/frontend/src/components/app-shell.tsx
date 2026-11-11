"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Mark } from "./mark";
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
  { href: "/today", label: "Today" },
  { href: "/coverage", label: "Coverage" },
  { href: "/pace", label: "Pace" },
  { href: "/plan", label: "Plan" },
] as const;

// Reached often enough to need a permanent home, not often enough to compete
// with the four above for the bottom bar's five slots. Kept visually quieter in
// the rail rather than hidden behind a menu, since a utility nobody can find is
// the problem being fixed, not the pattern to copy.
const SECONDARY = [
  { href: "/logs", label: "Study log" },
  { href: "/mocks", label: "Mock exams" },
  { href: "/settings", label: "Settings" },
] as const;

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
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
        <button type="button" className={styles.railCompose} onClick={onCompose}>
          Log a session
        </button>
        <ul className={styles.railSecondary}>
          {SECONDARY.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className={styles.railSecondaryLink}
                aria-current={pathname.startsWith(item.href) ? "page" : undefined}
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <main className={styles.main} id="main">
        {children}
      </main>

      <nav className={styles.bar} aria-label="Main">
        {NAV.slice(0, 2).map((item) => (
          <BarLink key={item.href} href={item.href} label={item.label} pathname={pathname} />
        ))}
        <button type="button" className={styles.compose} onClick={onCompose}>
          <span aria-hidden="true" className={styles.composeGlyph} />
          Log
        </button>
        {NAV.slice(2).map((item) => (
          <BarLink key={item.href} href={item.href} label={item.label} pathname={pathname} />
        ))}
        <BarLink href="/settings" label="Settings" pathname={pathname} />
      </nav>
    </div>
  );
}

function BarLink({ href, label, pathname }: { href: string; label: string; pathname: string }) {
  const active = pathname.startsWith(href);
  return (
    <Link href={href} className={styles.barLink} aria-current={active ? "page" : undefined}>
      {label}
    </Link>
  );
}
