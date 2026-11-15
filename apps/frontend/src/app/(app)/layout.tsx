"use client";

import { Suspense } from "react";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { TopBar } from "@/components/shell/top-bar";
import { MobileBar } from "@/components/shell/mobile-bar";
import { CommandPalette } from "@/components/shell/command-palette";
import { PlanGuard } from "@/components/shell/plan-guard";
import { RecordProvider } from "@/components/record/record-provider";

// Every signed-in page renders inside this one shell; onboarding and the auth
// pages sit outside the group, so the plan guard never runs there.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <PlanGuard>
        <RecordProvider>
          <CommandPalette>
            <AppSidebar />
            {/* Not SidebarInset: it is a <main>, and the top bar is not main content. */}
            <div className="bg-background relative flex min-h-svh min-w-0 flex-1 flex-col">
              {/* useSearchParams (the tab crumb) needs a boundary to prerender. */}
              <Suspense fallback={<div className="border-border h-12 border-b" />}>
                <TopBar />
              </Suspense>
              <main
                id="main"
                tabIndex={-1}
                className="flex-1 pb-[calc(3.5rem+env(safe-area-inset-bottom))] outline-hidden md:pb-0"
              >
                {children}
              </main>
              <MobileBar />
            </div>
          </CommandPalette>
        </RecordProvider>
      </PlanGuard>
    </SidebarProvider>
  );
}
