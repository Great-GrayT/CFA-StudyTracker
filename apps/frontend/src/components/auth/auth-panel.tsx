"use client";

import { Mark } from "@/components/mark";
import { MarkMotionLazy } from "@/components/mark-motion-lazy";

// The animated mark loads lazily, so the sign-in panel renders at once with the
// static mark and the motion version takes over when it arrives.
export function AuthPanel({
  children,
  animatedMark = false,
}: {
  children: React.ReactNode;
  animatedMark?: boolean;
}) {
  return (
    <main id="main" className="bg-background text-foreground flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <div className="flex w-full max-w-[400px] flex-col items-center gap-6">
        <div className="flex flex-col items-center gap-3">
          {animatedMark ? <MarkMotionLazy size={48} /> : <Mark size={48} />}
          <h1 className="text-[20px] leading-7 font-semibold">Study Tracker</h1>
        </div>
        <div className="bg-card border-border w-full rounded-lg border p-6">{children}</div>
      </div>
    </main>
  );
}
