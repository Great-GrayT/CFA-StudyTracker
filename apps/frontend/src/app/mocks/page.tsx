"use client";

import { useId, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { useMocks, usePackages } from "@/lib/hooks";
import { usePlan } from "@/lib/hooks";
import { api } from "@/lib/api";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { keys } from "@/lib/hooks";
import type { MockExam } from "@/lib/types";
import styles from "./mocks.module.css";

const pct = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });
const plural = new Intl.PluralRules("en");
const examWord = (n: number) => (plural.select(n) === "one" ? "exam" : "exams");

export default function MocksPage() {
  const [showAdd, setShowAdd] = useState(false);
  const [asTable, setAsTable] = useState(false);

  const plan = usePlan();
  const planId = plan.data?.id;
  const mocks = useMocks(planId);
  const packages = usePackages();

  if (mocks.isLoading || plan.isLoading) {
    return (
      <AppShell>
        <div className={styles.skeleton} aria-busy="true" aria-label="Loading mock exams">
          <div className={styles.skelLine} />
          <div className={styles.skelBlock} />
          <div className={styles.skelRow} />
          <div className={styles.skelRow} />
        </div>
      </AppShell>
    );
  }

  if (!mocks.data || !packages.data || !planId) return null;

  return (
    <AppShell>
      <div className={styles.head}>
        <h1 className={styles.title}>Mock exams</h1>
        <button
          type="button"
          className={styles.addBtn}
          onClick={() => setShowAdd(true)}
          aria-label="Add mock exam"
        >
          + Add
        </button>
      </div>

      {mocks.data!.length > 0 && (
        <>
          <section aria-labelledby="summary-heading">
            <h2 id="summary-heading" className={styles.summary}>
              {summaryText(mocks.data!)}
            </h2>

            <div className={styles.chartContainer}>
              <MockChart exams={mocks.data!} packages={packages.data!} />
              <button
                type="button"
                className={styles.toggle}
                onClick={() => setAsTable((v) => !v)}
                aria-pressed={asTable}
              >
                {asTable ? "Chart" : "Table"}
              </button>
            </div>
          </section>

          {asTable ? (
            <MockTable exams={mocks.data!} packages={packages.data!} planId={planId} />
          ) : (
            <MockList exams={mocks.data!} packages={packages.data!} planId={planId} />
          )}
        </>
      )}

      {mocks.data.length === 0 && (
        <p className={styles.empty}>
          No mock exams logged. Mock scores are the strongest signal of real readiness, so log one
          when you sit it.
        </p>
      )}

      {showAdd && (
        <AddMockForm
          planId={planId}
          packages={packages.data}
          onClose={() => setShowAdd(false)}
        />
      )}
    </AppShell>
  );
}

function summaryText(exams: MockExam[]): string {
  if (exams.length === 0) return "";
  const sorted = [...exams].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const last = sorted[0];
  if (exams.length === 1) {
    return `Last ${pct.format(last.scorePercent)}%, one ${examWord(1)} so far.`;
  }

  const first = sorted[exams.length - 1];
  const delta = last.scorePercent - first.scorePercent;
  const sign = delta > 0 ? "up" : delta < 0 ? "down" : "same, ";
  const month = new Date(first.date).toLocaleString("en", { month: "short" });

  return `Last ${pct.format(last.scorePercent)}%, ${sign} ${Math.abs(delta)} points across ${exams.length} ${examWord(exams.length)} since ${month}.`;
}

function MockChart({ exams, packages }: { exams: MockExam[]; packages: any[] }): React.ReactElement | null {
  if (exams.length === 0) return null;

  const sorted = [...exams].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const packageMap = new Map(packages.map((p: any) => [p.id, p.name]));

  const shapeFunc = getShapeForPackage(sorted.map((e) => e.packageId));
  const chartId = useId();

  const svgWidth = 300;
  const svgHeight = 180;
  const padding = 20;
  const plotWidth = svgWidth - 2 * padding;
  const plotHeight = svgHeight - 2 * padding;

  const minDate = new Date(sorted[0].date).getTime();
  const maxDate = new Date(sorted[sorted.length - 1].date).getTime();
  const dateRange = maxDate - minDate || 1;

  const xScale = (date: string) => padding + ((new Date(date).getTime() - minDate) / dateRange) * plotWidth;
  const yScale = (score: number) => svgHeight - padding - (score / 100) * plotHeight;

  const dots = sorted.map((exam, i) => ({
    x: xScale(exam.date),
    y: yScale(exam.scorePercent),
    score: exam.scorePercent,
    date: exam.date,
    packageId: exam.packageId,
    index: i,
  }));

  let lineElement = null;
  let legendEntries: Array<{ packageId: string | null; shapeType: string; name: string }> = [];

  if (sorted.length >= 3) {
    const linePoints = dots.map((d) => `${d.x},${d.y}`).join(" ");
    lineElement = <polyline points={linePoints} className={styles.trendLine} />;

    const uniquePackages = [...new Set(sorted.map((e) => e.packageId))];
    legendEntries = uniquePackages.map((pid) => ({
      packageId: pid,
      shapeType: shapeFunc(pid),
      name: pid ? (packageMap.get(pid) ?? "Unknown") : "No package",
    }));
  } else if (sorted.length === 2) {
    const linePoints = dots.map((d) => `${d.x},${d.y}`).join(" ");
    lineElement = <polyline points={linePoints} className={styles.dashedLine} />;

    const uniquePackages = [...new Set(sorted.map((e) => e.packageId))];
    legendEntries = uniquePackages.map((pid) => ({
      packageId: pid,
      shapeType: shapeFunc(pid),
      name: pid ? (packageMap.get(pid) ?? "Unknown") : "No package",
    }));
  }

  return (
    <div>
      <svg
        className={styles.chart}
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        role="img"
        aria-labelledby={chartId}
      >
        <desc id={chartId}>
          Mock exam scores from {sorted[0].scorePercent}% to {sorted[sorted.length - 1].scorePercent}%
          across {sorted.length} exams
        </desc>

        <line x1={padding} y1={svgHeight - padding} x2={svgWidth - padding} y2={svgHeight - padding} className={styles.axis} />
        <line x1={padding} y1={padding} x2={padding} y2={svgHeight - padding} className={styles.axis} />

        <text x={padding - 2} y={padding - 4} className={styles.axisLabel}>
          100
        </text>
        <text x={padding - 2} y={svgHeight - padding + 12} className={styles.axisLabel}>
          0
        </text>

        {lineElement}

        {dots.map((dot) => {
          const shape = shapeFunc(dot.packageId);
          return (
            <g key={dot.index}>
              {shape === "circle" ? (
                <circle
                  cx={dot.x}
                  cy={dot.y}
                  r="5"
                  className={`${styles.dot} ${styles.circle}`}
                  aria-label={`${dot.score}% on ${new Date(dot.date).toLocaleDateString()}`}
                />
              ) : shape === "square" ? (
                <rect
                  x={dot.x - 5}
                  y={dot.y - 5}
                  width="10"
                  height="10"
                  className={`${styles.dot} ${styles.square}`}
                  aria-label={`${dot.score}% on ${new Date(dot.date).toLocaleDateString()}`}
                />
              ) : (
                <polygon
                  points={`${dot.x},${dot.y - 5} ${dot.x + 5},${dot.y + 5} ${dot.x - 5},${dot.y + 5}`}
                  className={`${styles.dot} ${styles.triangle}`}
                  aria-label={`${dot.score}% on ${new Date(dot.date).toLocaleDateString()}`}
                />
              )}
            </g>
          );
        })}
      </svg>

      {legendEntries.length > 0 && (
        <div className={styles.legend} role="list">
          {legendEntries.map((entry) => (
            <div key={entry.packageId ?? "none"} className={styles.legendEntry} role="listitem">
              <span
                className={`${styles.legendMark} ${entry.shapeType}`}
                aria-hidden="true"
              />
              {entry.name}
            </div>
          ))}
        </div>
      )}

      {sorted.length === 1 && (
        <p className={styles.hint}>One exam is a data point, not a trend.</p>
      )}

      {sorted.length >= 3 && (
        <p className={styles.trend}>
          Trend: from {sorted[0].scorePercent}% to {sorted[sorted.length - 1].scorePercent}%
        </p>
      )}
    </div>
  );
}

function getShapeForPackage(packageIds: (string | null)[]): (id: string | null) => string {
  const unique = [...new Set(packageIds)];
  const map: Record<string | "null", string> = {};

  unique.forEach((id, i) => {
    if (id === null) {
      map["null"] = "circle";
    } else {
      const shapes = ["square", "triangle", "circle"];
      map[id] = shapes[i % shapes.length];
    }
  });

  return (id) => map[id ?? "null"] ?? "circle";
}

function MockList({ exams, packages, planId }: { exams: MockExam[]; packages: any[]; planId: string }) {
  const deleteLog = useDeleteMock(planId);
  const packageMap = new Map(packages.map((p: any) => [p.id, p.name]));

  const sorted = [...exams].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return (
    <div className={styles.list} role="list">
      {sorted.map((exam) => (
        <MockRow
          key={exam.id}
          exam={exam}
          packageName={exam.packageId ? packageMap.get(exam.packageId) : undefined}
          onDelete={() => deleteLog.mutate(exam.id)}
          isDeleting={deleteLog.isPending}
        />
      ))}
    </div>
  );
}

function MockRow({
  exam,
  packageName,
  onDelete,
  isDeleting,
}: {
  exam: MockExam;
  packageName?: string;
  onDelete: () => void;
  isDeleting: boolean;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleDelete = () => {
    if (confirmDelete) {
      onDelete();
      setConfirmDelete(false);
    } else {
      setConfirmDelete(true);
    }
  };

  return (
    <div className={styles.row} role="listitem">
      <div className={styles.rowContent}>
        <div className={styles.rowDate}>{new Date(exam.date).toLocaleDateString()}</div>
        <div className={styles.rowScore} title={`${exam.scorePercent}%`}>
          {pct.format(exam.scorePercent)}%
        </div>
        {packageName && <div className={styles.rowPackage}>{packageName}</div>}
      </div>
      <button
        type="button"
        className={styles.deleteBtn}
        onClick={handleDelete}
        disabled={isDeleting}
        aria-label={confirmDelete ? "Confirm delete" : "Delete mock exam"}
        title={confirmDelete ? "Click again to confirm" : "Delete this mock exam"}
      >
        {confirmDelete ? "Confirm" : "Delete"}
      </button>
    </div>
  );
}

function MockTable({ exams, packages, planId }: { exams: MockExam[]; packages: any[]; planId: string }) {
  const deleteLog = useDeleteMock(planId);
  const packageMap = new Map(packages.map((p: any) => [p.id, p.name]));

  const sorted = [...exams].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return (
    <table className={`${styles.table} tnum`}>
      <caption className="visually-hidden">Mock exams by date, newest first</caption>
      <thead>
        <tr>
          <th scope="col">Date</th>
          <th scope="col">Score</th>
          <th scope="col">Package</th>
          <th scope="col">Action</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((exam) => (
          <MockTableRow
            key={exam.id}
            exam={exam}
            packageName={exam.packageId ? packageMap.get(exam.packageId) : undefined}
            onDelete={() => deleteLog.mutate(exam.id)}
            isDeleting={deleteLog.isPending}
          />
        ))}
      </tbody>
    </table>
  );
}

function MockTableRow({
  exam,
  packageName,
  onDelete,
  isDeleting,
}: {
  exam: MockExam;
  packageName?: string;
  onDelete: () => void;
  isDeleting: boolean;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleDelete = () => {
    if (confirmDelete) {
      onDelete();
      setConfirmDelete(false);
    } else {
      setConfirmDelete(true);
    }
  };

  return (
    <tr>
      <td>{new Date(exam.date).toLocaleDateString()}</td>
      <td>{pct.format(exam.scorePercent)}%</td>
      <td>{packageName ?? "-"}</td>
      <td>
        <button
          type="button"
          className={styles.deleteBtn}
          onClick={handleDelete}
          disabled={isDeleting}
          aria-label={confirmDelete ? "Confirm delete" : "Delete mock exam"}
        >
          {confirmDelete ? "Confirm" : "Delete"}
        </button>
      </td>
    </tr>
  );
}

function AddMockForm({
  planId,
  packages,
  onClose,
}: {
  planId: string;
  packages: any[];
  onClose: () => void;
}) {
  const [formData, setFormData] = useState({
    date: new Date().toISOString().split("T")[0],
    scorePercent: 50,
    packageId: "",
    note: "",
  });

  const qc = useQueryClient();
  const createMock = useMutation({
    mutationFn: (data) =>
      api.post<MockExam>("mock-exams", {
        planId,
        date: formData.date,
        scorePercent: formData.scorePercent,
        packageId: formData.packageId || null,
        note: formData.note || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.mocks(planId) });
      onClose();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMock.mutate(formData as any);
  };

  return (
    <div className={styles.formOverlay} role="dialog" aria-modal="true">
      <div className={styles.formContainer}>
        <h2 className={styles.formTitle}>Add mock exam</h2>
        <form onSubmit={handleSubmit}>
          <div className={styles.formGroup}>
            <label htmlFor="mock-date">Date</label>
            <input
              id="mock-date"
              type="date"
              value={formData.date}
              onChange={(e) => setFormData({ ...formData, date: e.target.value })}
              required
            />
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="mock-score">Score (%)</label>
            <input
              id="mock-score"
              type="number"
              min="0"
              max="100"
              value={formData.scorePercent}
              onChange={(e) => setFormData({ ...formData, scorePercent: parseInt(e.target.value) })}
              required
            />
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="mock-package">Package (optional)</label>
            <select
              id="mock-package"
              value={formData.packageId}
              onChange={(e) => setFormData({ ...formData, packageId: e.target.value })}
            >
              <option value="">None</option>
              {packages.map((pkg: any) => (
                <option key={pkg.id} value={pkg.id}>
                  {pkg.name}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="mock-note">Note (optional)</label>
            <input
              id="mock-note"
              type="text"
              value={formData.note}
              onChange={(e) => setFormData({ ...formData, note: e.target.value })}
              placeholder="e.g., Took during lunch break"
            />
          </div>

          <div className={styles.formActions}>
            <button type="button" onClick={onClose} className={styles.cancelBtn}>
              Cancel
            </button>
            <button type="submit" disabled={createMock.isPending} className={styles.submitBtn}>
              {createMock.isPending ? "Saving..." : "Add"}
            </button>
          </div>

          {createMock.isError && (
            <p className={styles.error} role="alert">
              {createMock.error instanceof Error ? createMock.error.message : "Failed to save"}
            </p>
          )}
        </form>
      </div>
    </div>
  );
}

function useDeleteMock(planId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mockId: string) => api.del<unknown>(`mock-exams/${mockId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.mocks(planId) });
    },
  });
}
