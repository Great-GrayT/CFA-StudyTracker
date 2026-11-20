import { cn } from "@/lib/utils";
import { SEG_LABEL, type SegKey } from "@/lib/pace-view";
import s from "./plan-metrics.module.css";

export const SEG_CLASS: Record<SegKey, string> = { "1": s.k1, "2": s.k2, "3": s.k3, "4": s.k4, "5": s.k5, "5r": s.k5r };
const KEYS: SegKey[] = ["1", "2", "3", "4", "5", "5r"];

/** Swatches for the ribbon and calendar stacks. Mock review is hatched so it differs from the session by pattern. */
export function StepLegend() {
  return (
    <ul className={s.legend}>
      {KEYS.map((k) => (
        <li key={k}>
          <span className={cn(s.sw, SEG_CLASS[k])} aria-hidden />
          {SEG_LABEL[k]}
        </li>
      ))}
      <li>Lighter columns are planned days, faded ones are past days with no study</li>
    </ul>
  );
}
