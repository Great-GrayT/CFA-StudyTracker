import type { ReactNode } from "react";

// Hairline between sections, not a card around each one. scroll-mt clears the
// top bar when a sub-nav link or a Today link lands on the anchor.
export function SettingsSection({
  id,
  title,
  lede,
  children,
}: {
  id: string;
  title: string;
  lede?: string;
  children: ReactNode;
}) {
  const headingId = `${id}-heading`;
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className="border-border scroll-mt-16 border-t py-8 first:border-t-0 first:pt-0"
    >
      <h2 id={headingId} className="text-[16px] leading-tight font-semibold">
        {title}
      </h2>
      {lede && <p className="text-muted-foreground mt-1 text-[14px] leading-relaxed">{lede}</p>}
      <div className="mt-5 flex flex-col gap-5">{children}</div>
    </section>
  );
}
