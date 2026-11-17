"use client";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

/**
 * The maximised view of a tile. A wide panel on desktop, full screen under
 * 760 px. The body is a flex column with a bounded height so tables scroll
 * inside it with their header pinned, never the page behind.
 */
export function ExpandSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="h-dvh w-full max-w-none gap-3 rounded-none p-4 sm:rounded-l-xl md:max-w-[min(1040px,94vw)] md:p-6 max-[759px]:max-w-none"
      >
        <SheetHeader className="p-0 pr-10">
          <SheetTitle className="text-[16px] font-semibold">{title}</SheetTitle>
          <SheetDescription className="text-[13px]">{description}</SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
