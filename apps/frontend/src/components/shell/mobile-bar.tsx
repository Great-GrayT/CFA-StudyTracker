"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus } from "lucide-react";
import { NAV } from "@/lib/shell";
import { cn } from "@/lib/utils";
import { useRecord } from "@/components/record/record-provider";
import { isActive } from "./app-sidebar";

// Five slots so Record sits dead centre, in thumb reach. Settings is in the
// top bar's account menu: a sixth slot would push targets under 44px.
const SLOT =
  "relative flex min-h-14 flex-col items-center justify-center gap-0.5 text-[12px] leading-none outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset";

export function MobileBar() {
  const pathname = usePathname();
  const record = useRecord();
  const [today, syllabus, progress, plan] = NAV;

  const link = (item: (typeof NAV)[number]) => {
    const active = isActive(pathname, item.href);
    const Icon = item.icon;
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={cn(SLOT, active ? "text-foreground font-medium" : "text-muted-foreground")}
      >
        {/* Colour plus a rule, so the active page does not rely on hue alone. */}
        <span
          aria-hidden="true"
          className={cn("absolute inset-x-5 top-0 h-[2px]", active ? "bg-primary" : "bg-transparent")}
        />
        <Icon aria-hidden="true" className="size-5" />
        {item.label}
      </Link>
    );
  };

  return (
    <nav
      aria-label="Main"
      className="bg-background border-border fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {link(today)}
      {link(syllabus)}
      <button
        type="button"
        onClick={() => record.open()}
        className={cn(SLOT, "text-foreground font-medium")}
      >
        <span
          aria-hidden="true"
          className="bg-primary text-primary-foreground flex h-7 w-10 items-center justify-center rounded-md"
        >
          <Plus className="size-5" />
        </span>
        Record
      </button>
      {link(progress)}
      {link(plan)}
    </nav>
  );
}
