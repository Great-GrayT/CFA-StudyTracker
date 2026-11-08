"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Mark } from "./mark";
import styles from "./app-shell.module.css";

// Four destinations, plus the composer as the bar's centre item.
//
// The composer sits IN the bar rather than floating above content: a floating
// action button covers the last list row on a phone, and the bottom centre is
// the easiest place to reach one-handed.
const NAV = [
  { href: "/today", label: "Today" },
  { href: "/coverage", label: "Coverage" },
  { href: "/pace", label: "Pace" },
  { href: "/plan", label: "Plan" },
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
