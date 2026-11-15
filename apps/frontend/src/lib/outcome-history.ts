// History decisions for the outcome sheet's `?los=`, kept pure so they are
// tested; hooks/use-outcome-param.ts applies them.

type Seen = { pathname: string; los: string | null };
export type Arrival = "clear" | "backable" | "keep" | "insert";
type Flags = { backable: boolean; closing: boolean };

/**
 * What the history owner does when the URL it sees changes.
 * - clear: no sheet, so nothing to step back over.
 * - backable: the entry underneath is this page without the sheet.
 * - keep: another outcome in the same open sheet; nothing changes.
 * - insert: the sheet arrived without a sheetless entry behind it (a direct
 *   load, or a link from another page), so put one there.
 */
export function arrivalAction(a: {
  prev: Seen | null;
  pathname: string;
  los: string | null;
  /** performance navigation type of the document's first load. */
  navType: string;
  /** The mark on the current history entry, if this hook pushed it. */
  mark: string | undefined;
  /** True only for the first arrival in this document; navType describes that load alone. */
  firstArrival: boolean;
}): Arrival {
  if (!a.los) return "clear";
  if (a.prev && a.prev.pathname === a.pathname) return a.prev.los === null ? "backable" : "keep";
  if (a.mark === a.los) return "backable";
  // The document loaded by reload or Back/Forward onto an entry an earlier
  // visit already arranged; inserting again would add a Back step.
  if (a.firstArrival && (a.navType === "reload" || a.navType === "back_forward")) return "backable";
  return "insert";
}

/** Switching outcome inside an open sheet replaces, so Back still closes it in one step. */
export function openAction(current: string | null, next: string): "push" | "replace" | "none" {
  if (current === next) return "none";
  return current ? "replace" : "push";
}

/** A second close before Back lands must not also strip the param from the entry. */
export function closeAction(s: { backable: boolean; closing: boolean }): "back" | "replace" | "none" {
  if (s.closing) return "none";
  return s.backable ? "back" : "replace";
}

/**
 * Flags after an arrival. Any URL change ends a pending close, so a Back that
 * lands on another `?los=` entry leaves a sheet that can still close.
 */
export function flagsAfter(action: Arrival, flags: Flags): Flags {
  const backable = action === "clear" ? false : action === "keep" ? flags.backable : true;
  return { backable, closing: false };
}
