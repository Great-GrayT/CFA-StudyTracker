"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export const SETTINGS_SECTIONS = [
  { id: "account", label: "Account" },
  { id: "security", label: "Security" },
  { id: "coach", label: "Coach and devices" },
  { id: "location", label: "Where you study" },
  { id: "system", label: "System health" },
  { id: "data", label: "Your data" },
  { id: "start-over", label: "Start over" },
  { id: "delete", label: "Delete account" },
] as const;

// The band sits a quarter of the way down the viewport, so the section under
// the reader's eye wins even when two are partly visible.
export function SettingsNav({ className }: { className?: string }) {
  const [active, setActive] = useState<string>(SETTINGS_SECTIONS[0].id);

  useEffect(() => {
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        const first = SETTINGS_SECTIONS.find((s) => visible.has(s.id));
        if (first) setActive(first.id);
      },
      { rootMargin: "-25% 0px -60% 0px" },
    );
    for (const s of SETTINGS_SECTIONS) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <nav aria-label="Settings sections" className={className}>
      <ul className="border-border flex flex-col border-l">
        {SETTINGS_SECTIONS.map((s) => {
          const on = s.id === active;
          return (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                aria-current={on ? "location" : undefined}
                className={cn(
                  "-ml-px block border-l py-1.5 pl-3 text-[13px] transition-colors focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none",
                  on
                    ? "border-primary text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground border-transparent",
                )}
              >
                {s.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
