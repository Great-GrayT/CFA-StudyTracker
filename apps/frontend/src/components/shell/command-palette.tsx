"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { BookMarked, FileText, Layers, Zap } from "lucide-react";
import { useCurriculum, usePlan } from "@/lib/hooks";
import { ApiError, messageForStatus } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { commandItems, type CommandItem as Item } from "@/lib/shell";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useRecord } from "@/components/record/record-provider";
import { ADD_HOLIDAY_HREF, ADD_MOCK_HREF, exportEverything, useSignOut } from "./shell-actions";

type PaletteApi = { openPalette(): void };
const PaletteContext = createContext<PaletteApi | null>(null);

export function usePalette(): PaletteApi {
  const ctx = useContext(PaletteContext);
  if (!ctx) throw new Error("usePalette must be used inside CommandPalette.");
  return ctx;
}

const GROUP_ICON = { Pages: FileText, Actions: Zap, Topics: Layers, Outcomes: BookMarked } as const;
const GROUP_ORDER = ["Pages", "Actions", "Topics", "Outcomes"] as const;

export function CommandPalette({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const router = useRouter();
  const record = useRecord();
  const { resolvedTheme, setTheme } = useTheme();
  const signOut = useSignOut();
  const plan = usePlan();
  const curriculum = useCurriculum(plan.data?.levelId);
  const items = useMemo(() => commandItems(curriculum.data), [curriculum.data]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey) && !e.altKey) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const run = useCallback(
    (item: Item) => {
      setOpen(false);
      if (item.href) return router.push(item.href);
      switch (item.action) {
        case "record":
          // After the dialog closes, so focus lands in the sheet, not back on the trigger.
          return setTimeout(() => record.open(), 0);
        case "add-mock":
          return router.push(ADD_MOCK_HREF);
        case "add-holiday":
          return router.push(ADD_HOLIDAY_HREF);
        case "export":
          return void exportEverything();
        case "toggle-theme":
          return setTheme(resolvedTheme === "dark" ? "light" : "dark");
        case "sign-out":
          return void signOut();
      }
    },
    [router, record, resolvedTheme, setTheme, signOut],
  );

  // Hundreds of outcomes are noise until the candidate types; mounting them
  // only on a query also keeps the palette instant to open.
  const searching = query.trim().length >= 2;
  const groups = GROUP_ORDER.filter((g) => searching || g === "Pages" || g === "Actions").map((g) => ({
    group: g,
    items: items.filter((i) => i.group === g),
  }));

  const api = useMemo(() => ({ openPalette: () => setOpen(true) }), []);

  return (
    <PaletteContext.Provider value={api}>
      {children}
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Search"
        description="Go to a page, topic or outcome, or run an action."
      >
        <CommandInput placeholder="Search pages, topics and outcomes" value={query} onValueChange={setQuery} />
        <CommandList className="max-h-[min(420px,60dvh)]">
          {/* On a failed load the alert below explains the gap instead. */}
          {curriculum.isError ? null : (
            <CommandEmpty>
              {curriculum.isLoading ? "The syllabus is still loading." : "Nothing matches. Try a shorter word."}
            </CommandEmpty>
          )}
          {/* Pages and actions still work; only topics and outcomes are missing. */}
          {curriculum.isError && searching ? (
            <div className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]" role="alert">
              <span>
                {messageForStatus(
                  curriculum.error instanceof ApiError ? curriculum.error.status : 0,
                  "The syllabus did not load, so topics and outcomes are missing.",
                )}
              </span>
              <Button type="button" variant="outline" size="sm" onClick={() => void curriculum.refetch()}>
                Retry
              </Button>
            </div>
          ) : null}
          {groups.map(({ group, items: list }) =>
            list.length ? (
              <CommandGroup key={group} heading={group}>
                {list.map((item) => {
                  const Icon = GROUP_ICON[item.group];
                  return (
                    <CommandItem
                      key={item.id}
                      value={`${item.label} ${item.id}`}
                      keywords={item.keywords}
                      onSelect={() => run(item)}
                      className="min-h-9 py-2 max-md:min-h-11"
                    >
                      <Icon aria-hidden="true" />
                      {item.group === "Outcomes" ? (
                        <span className="min-w-0 flex-1">
                          <span className="font-prose line-clamp-2 text-[16px] leading-snug">{item.label}</span>
                          <span className="text-muted-foreground block truncate text-[12px]">
                            {item.keywords?.[0]}
                          </span>
                        </span>
                      ) : (
                        <span className="truncate">{item.label}</span>
                      )}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ) : null,
          )}
        </CommandList>
      </CommandDialog>
    </PaletteContext.Provider>
  );
}
