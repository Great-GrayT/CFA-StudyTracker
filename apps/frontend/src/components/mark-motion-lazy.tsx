import dynamic from "next/dynamic";
import { Mark } from "./mark";

// The animation library is not on the critical path for signing in.
//
// Imported directly, motion/react put the sign-in screen's first load at
// 177KB against a 180KB budget, for a flourish nobody is waiting on. Loaded
// this way the static mark renders immediately and the animated one takes
// over when it arrives, which also means a slow connection gets a logo rather
// than a gap.
const MarkMotionComponent = dynamic(
  () => import("./mark-motion").then((mod) => ({ default: mod.MarkMotion })),
  {
    ssr: false,
    loading: () => <Mark size={56} />,
  },
);

type MarkMotionLazyProps = React.ComponentProps<typeof MarkMotionComponent>;

export function MarkMotionLazy(props: MarkMotionLazyProps) {
  return <MarkMotionComponent {...props} />;
}
