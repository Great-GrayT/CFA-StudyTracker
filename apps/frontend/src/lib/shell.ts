import { BookOpen, CalendarRange, LineChart, Package, Settings, Sun, type LucideIcon } from "lucide-react";
import type { Curriculum } from "./types";

// Shell rules kept out of components so they can be tested without a DOM tree.

export const NAV: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/today", label: "Today", icon: Sun },
  { href: "/syllabus", label: "Syllabus", icon: BookOpen },
  { href: "/progress", label: "Progress", icon: LineChart },
  { href: "/packages", label: "Packages", icon: Package },
  { href: "/plan", label: "Plan", icon: CalendarRange },
  { href: "/settings", label: "Settings", icon: Settings },
];

// Inputs that take a click, not keystrokes, so a bare R there is a shortcut.
const NON_TEXT_INPUTS = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image"]);
const TYPING_ROLES = new Set(["combobox", "textbox", "searchbox", "spinbutton"]);

export function isTypingTarget(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return !NON_TEXT_INPUTS.has((el as HTMLInputElement).type);
  const role = el.getAttribute("role");
  if (role && TYPING_ROLES.has(role)) return true;
  // Browsers answer isContentEditable (inherited by children). jsdom has no
  // contentEditable IDL, so fall back to the property or attribute up the tree.
  if ((el as HTMLElement).isContentEditable) return true;
  for (let node: Element | null = el; node; node = node.parentElement) {
    const value = (node as HTMLElement).contentEditable ?? node.getAttribute("contenteditable");
    if (value === "true" || value === "" || value === "plaintext-only") return true;
    if (value === "false") return false;
  }
  return false;
}

function under(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

/**
 * Where a plan lookup result should send the visitor, or null to stay.
 * "error" covers offline and 5xx: bouncing then would strand a candidate who
 * has a plan but no signal.
 */
export function planGuardTarget(
  status: "ok" | 404 | 401 | "error",
  pathname: string,
): string | null {
  if (status === 401) return under(pathname, "/login") ? null : "/login";
  if (status !== 404) return null;
  // Settings stays reachable so a planless account can still be managed or deleted.
  if (under(pathname, "/onboarding") || under(pathname, "/settings")) return null;
  return "/onboarding";
}

export type CommandItem = {
  group: "Outcomes" | "Topics" | "Pages" | "Actions";
  id: string;
  label: string;
  href?: string;
  action?: string;
  /** Extra words cmdk matches on, such as the outcome's reading. */
  keywords?: string[];
};

export const ACTIONS: { action: string; label: string }[] = [
  { action: "record", label: "Record study" },
  { action: "add-mock", label: "Add mock exam" },
  { action: "add-holiday", label: "Add holiday" },
  { action: "export", label: "Export everything" },
  { action: "toggle-theme", label: "Toggle theme" },
  { action: "sign-out", label: "Sign out" },
];

export function commandItems(curriculum: Curriculum | undefined): CommandItem[] {
  const items: CommandItem[] = NAV.map((n) => ({
    group: "Pages",
    id: `page:${n.href}`,
    label: n.label,
    href: n.href,
  }));
  for (const a of ACTIONS) items.push({ group: "Actions", id: `action:${a.action}`, label: a.label, action: a.action });

  const topics = [...(curriculum?.topics ?? [])].sort((a, b) => a.order - b.order);
  for (const t of topics) {
    items.push({ group: "Topics", id: `topic:${t.id}`, label: t.name, href: `/syllabus/${encodeURIComponent(t.id)}` });
  }
  for (const t of topics) {
    for (const r of [...t.readings].sort((a, b) => a.order - b.order)) {
      for (const l of [...r.los].sort((a, b) => a.order - b.order)) {
        items.push({
          group: "Outcomes",
          id: `los:${l.id}`,
          label: l.text,
          href: `/syllabus?los=${encodeURIComponent(l.id)}`,
          keywords: [r.name, t.name],
        });
      }
    }
  }
  return items;
}

// Pages that still live at their old address until their task moves them.
const SECTION_LABEL: Record<string, string> = {
  ...Object.fromEntries(NAV.map((n) => [n.href.slice(1), n.label])),
  coverage: "Coverage",
  los: "Outcome",
  pace: "Pace",
  mocks: "Mock exams",
  logs: "Study record",
  watchdogs: "Watchdogs",
  explore: "Explore in 3D",
};

const sentence = (s: string) => {
  const words = s.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/**
 * The top bar trail: section, then any id segment by its name, then the tab.
 * `names` maps ids (topic ids, outcome ids) to what the candidate calls them.
 */
export function breadcrumbTrail(
  pathname: string,
  tab: string | null,
  names: Record<string, string> = {},
): { label: string; href?: string }[] {
  const parts = pathname.split("/").filter(Boolean);
  const trail: { label: string; href?: string }[] = parts.map((part, i) => {
    const decoded = decodeURIComponent(part);
    const label =
      i === 0 ? (SECTION_LABEL[part] ?? sentence(decoded)) : (names[decoded] ?? SECTION_LABEL[part] ?? "Detail");
    return { label, href: `/${parts.slice(0, i + 1).join("/")}` };
  });
  if (tab) trail.push({ label: sentence(tab), href: `${pathname}?tab=${encodeURIComponent(tab)}` });
  if (trail.length) delete trail[trail.length - 1].href;
  return trail;
}

/**
 * The plan lookup as the guard sees it, or null while loading. The error is
 * read first: React Query keeps cached (and persisted) data when a refetch
 * fails, so checking data first would hide a 404 or 401 behind an old plan.
 * Any other failure with a plan in hand is offline, and the page stays.
 */
export function planStatus(q: {
  data: unknown;
  error: unknown;
}): "ok" | 404 | 401 | "error" | null {
  const status = (q.error as { status?: unknown } | null)?.status;
  if (status === 404 || status === 401) return status;
  if (q.data) return "ok";
  return q.error ? "error" : null;
}
