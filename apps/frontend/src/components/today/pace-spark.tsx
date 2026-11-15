"use client";

import { Line, LineChart, ReferenceLine, YAxis } from "recharts";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";

const chartConfig = { delta: { label: "Outcomes ahead or behind", color: "var(--claimed)" } } satisfies ChartConfig;

/** Ahead or behind per day; the dashed line is on pace. Decorative: the figure above says it. */
export function PaceSpark({ data }: { data: { date: string; delta: number }[] }) {
  return (
    <ChartContainer config={chartConfig} className="aspect-auto h-10 w-full" aria-hidden="true">
      <LineChart data={data} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
        <YAxis hide domain={["dataMin", "dataMax"]} />
        <ReferenceLine y={0} stroke="var(--rule-strong)" strokeDasharray="2 2" />
        <Line dataKey="delta" type="linear" stroke="var(--color-delta)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
      </LineChart>
    </ChartContainer>
  );
}
