"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { isTypingTarget } from "@/lib/shell";
import { RecordSheet } from "./record-sheet";

export type RecordPreset = { taskId?: string; losId?: string; date?: string };

type RecordApi = { open(preset?: RecordPreset): void; close(): void };

const RecordContext = createContext<RecordApi | null>(null);

export function useRecord(): RecordApi {
  const ctx = useContext(RecordContext);
  if (!ctx) throw new Error("useRecord must be used inside RecordProvider.");
  return ctx;
}

// One sheet for the whole app: every Record control opens this one, so the
// form, its endpoint and its toast cannot drift between pages.
export function RecordProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  // A fresh object per open, so reopening with the same preset still reapplies it.
  const [preset, setPreset] = useState<RecordPreset>({});

  const open = useCallback((p?: RecordPreset) => {
    setPreset({ ...p });
    setOpen(true);
  }, []);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "r" && e.key !== "R") return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || e.defaultPrevented) return;
      if (isTypingTarget(document.activeElement)) return;
      // Another dialog (palette, menu) owns the keyboard while it is open.
      if (document.querySelector('[role="dialog"][data-state="open"], [role="menu"]')) return;
      e.preventDefault();
      open();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const api = useMemo(() => ({ open, close }), [open, close]);

  return (
    <RecordContext.Provider value={api}>
      {children}
      <RecordSheet open={isOpen} onOpenChange={setOpen} preset={preset} />
    </RecordContext.Provider>
  );
}
