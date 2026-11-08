"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { WeightGap } from "@/components/weight-gap";
import { usePlan, useCurriculum, useLogs } from "@/lib/hooks";
import type { TopicCoverage } from "@/lib/coverage";
import styles from "./explore.module.css";

// The 3D view is opt-in and lives on its own route, so three.js, R3F and drei
// stay entirely outside the bundle of every other screen. Loading it here
// rather than at the app shell is what keeps Today's first load small.
const Massif = dynamic(() => import("@/components/massif").then((m) => m.Massif), {
  ssr: false,
  loading: () => <div className={styles.unsupported}>Preparing the 3D view.</div>,
});

export default function ExplorePage() {
  const router = useRouter();
  const [supported] = useState(() => {
    if (typeof window === "undefined") return true;
    try {
      const canvas = document.createElement("canvas");
      return !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
    } catch {
      return false;
    }
  });

  const plan = usePlan();
  const curriculum = useCurriculum(plan.data?.levelId);
  const logs = useLogs(plan.data?.id);

  const { topics, readingCounts } = useMemo(() => {
    if (!curriculum.data || !logs.data) {
      return { topics: [] as TopicCoverage[], readingCounts: new Map<string, number>() };
    }
    const covered = new Set(logs.data.map((l) => l.losId));
    const counts = new Map<string, number>();
    const list = curriculum.data.topics.map((t) => {
      counts.set(t.id, t.readings.length);
      const ids = t.readings.flatMap((r) => r.los.map((l) => l.id));
      return {
        topicId: t.id,
        name: t.name,
        weightMin: t.examWeightMin,
        weightMax: t.examWeightMax,
        covered: ids.filter((id) => covered.has(id)).length,
        total: ids.length,
      };
    });
    return { topics: list, readingCounts: counts };
  }, [curriculum.data, logs.data]);

  return (
    <AppShell>
      <Link href="/coverage" className={styles.back}>
        Back to coverage
      </Link>
      <h1 className={styles.title}>Explore</h1>
      <p className={styles.hint}>
        Each stack is a topic. Its width is the topic&apos;s share of the exam, and each disc is one
        reading, filled once you have covered it. Drag to orbit, tap a stack to open it.
      </p>

      {supported && topics.length > 0 ? (
        <>
          <Massif
            topics={topics}
            readingCounts={readingCounts}
            onSelect={(id) => router.push(`/coverage/${id}`)}
          />
          <ul className={styles.legend}>
            <li>
              <span className={styles.swatchCovered} /> Covered reading
            </li>
            <li>
              <span className={styles.swatchUntouched} /> Still to cover
            </li>
          </ul>
        </>
      ) : (
        <p className={styles.unsupported}>
          {supported
            ? "Loading your coverage."
            : "This device cannot draw the 3D view. The chart below has the same data."}
        </p>
      )}

      {/* Always present, not only as a fallback: this is the accessible path
          to the same numbers, and the 3D canvas is marked aria-hidden. */}
      <WeightGap topics={topics} onSelect={(id) => router.push(`/coverage/${id}`)} />
    </AppShell>
  );
}
