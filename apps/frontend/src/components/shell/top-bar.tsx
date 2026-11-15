"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Plus, Search } from "lucide-react";
import { useCurriculum, usePlan } from "@/lib/hooks";
import { breadcrumbTrail } from "@/lib/shell";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useRecord } from "@/components/record/record-provider";
import { usePalette } from "./command-palette";
import { AccountAvatar, AccountMenuItems, ThemeRadio } from "./app-sidebar";
import { useHydrated } from "./shell-actions";

function useShortcutHint(): string {
  const [hint, setHint] = useState("Ctrl K");
  useEffect(() => {
    // Platform is only known in the browser; Ctrl K is the server's guess.
    if (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)) setHint("⌘K");
  }, []);
  return hint;
}

export function TopBar() {
  const pathname = usePathname();
  const tab = useSearchParams().get("tab");
  const plan = usePlan();
  const curriculum = useCurriculum(plan.data?.levelId);
  const record = useRecord();
  const { openPalette } = usePalette();
  const hint = useShortcutHint();
  const hydrated = useHydrated();

  // Topic and outcome ids in the path read as their names.
  // Names wait for hydration: the server has no cached curriculum to match.
  const names = useMemo(() => {
    const out: Record<string, string> = {};
    for (const t of (hydrated ? curriculum.data?.topics : undefined) ?? []) {
      out[t.id] = t.name;
      for (const r of t.readings) for (const l of r.los) out[l.id] = r.name;
    }
    return out;
  }, [curriculum.data, hydrated]);
  const trail = breadcrumbTrail(pathname, tab, names);

  return (
    <header className="bg-background border-border sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 border-b px-3 md:px-4">
      <SidebarTrigger className="text-muted-foreground hover:text-foreground -ml-1 hidden size-8 md:inline-flex" />
      <Breadcrumb className="min-w-0 flex-1">
        <BreadcrumbList className="flex-nowrap gap-1.5 text-[14px] sm:gap-1.5">
          {trail.map((crumb, i) => (
            <Fragment key={`${crumb.label}-${i}`}>
              {i > 0 ? <BreadcrumbSeparator className="text-muted-foreground/70" /> : null}
              <BreadcrumbItem className={i < trail.length - 1 ? "hidden shrink-0 sm:inline-flex" : "min-w-0"}>
                {crumb.href ? (
                  <BreadcrumbLink asChild>
                    <Link href={crumb.href}>{crumb.label}</Link>
                  </BreadcrumbLink>
                ) : (
                  <BreadcrumbPage className="truncate font-medium">{crumb.label}</BreadcrumbPage>
                )}
              </BreadcrumbItem>
            </Fragment>
          ))}
        </BreadcrumbList>
      </Breadcrumb>

      <Button
        variant="outline"
        size="sm"
        onClick={openPalette}
        aria-label="Search"
        aria-keyshortcuts="Control+K Meta+K"
        className="text-muted-foreground hover:text-foreground h-8 gap-2 border-border px-2.5 max-md:size-11 max-md:border-0 md:w-56 md:justify-start"
      >
        <Search aria-hidden="true" />
        <span className="hidden md:inline">Search</span>
        <kbd className="text-muted-foreground border-border ml-auto hidden rounded-sm border px-1.5 font-sans text-[12px] leading-5 tabular-nums md:inline">
          {hint}
        </kbd>
      </Button>

      <Button
        size="sm"
        onClick={() => record.open()}
        aria-keyshortcuts="R"
        className="hidden h-8 md:inline-flex"
      >
        <Plus aria-hidden="true" />
        Record
      </Button>

      {/* Phones have no sidebar, so Settings, theme and sign out live here. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-11 md:hidden" aria-label="Account and settings">
            <AccountAvatar className="size-7" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <AccountMenuItems />
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-muted-foreground text-[12px] font-normal">Theme</DropdownMenuLabel>
          <ThemeRadio />
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}

