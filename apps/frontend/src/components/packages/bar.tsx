import { cn } from "@/lib/utils";
import { fraction } from "@/lib/coverage-view";

/** Thin meter; the figures beside it carry the value, so it is decoration for screen readers. */
export function Bar({ n, of, className }: { n: number; of: number; className?: string }) {
  return (
    <div aria-hidden="true" className={cn("bg-muted h-1.5 w-full overflow-hidden", className)}>
      <div className="bg-claimed h-full" style={{ width: `${fraction(n, of) * 100}%` }} />
    </div>
  );
}
