import dynamic from "next/dynamic";
import { Mark } from "./mark";

const Mark3DComponent = dynamic(
  () => import("./mark-3d").then((mod) => ({ default: mod.Mark3D })),
  {
    ssr: false,
    loading: () => <Mark size={64} />,
  },
);

type Mark3DLazyProps = React.ComponentProps<typeof Mark3DComponent>;

export function Mark3DLazy(props: Mark3DLazyProps) {
  return <Mark3DComponent {...props} />;
}
