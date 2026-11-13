"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ApiError, messageForStatus } from "@/lib/api";
import { useCurriculum } from "@/lib/hooks";
import type { Plan, Topic } from "@/lib/types";
import { ConfidencePicker } from "./confidence";
import styles from "./prior-work.module.css";

// What the candidate had already studied before the plan took over.
//
// Lives in Settings as well as onboarding: people arrive having studied on
// their own, and they also go their own way for a fortnight mid-plan.
//
// Declared per topic, because that is what anyone remembers, with an opening
// into the topic's modules for the candidate who knows exactly which videos
// they watched. Each kind of work names its material, because a Kaplan video
// and a Meldrum video are the same coverage but a question bank is only
// settled by questions answered in it.

type SourceKind = "notes" | "videos" | "questions";
type Source = { id: string; name: string };
type PriorWorkData = { sources: Record<SourceKind, Source[]>; declarations: Declaration[] };

type Declaration = {
  topicId: string;
  readingId: string | null;
  notesFrom: string | null;
  videosFrom: string | null;
  questions: { from: string | null; answered: number; accuracyPercent: number | null } | null;
  confidence: number | null;
};

/** One row of the form, kept as typed text until it is sent. */
type Row = {
  notesFrom: string;
  videosFrom: string;
  questionsFrom: string;
  answered: string;
  accuracy: string;
  confidence: number;
};

// Work saved by the original form named no material.
const UNATTRIBUTED = "unattributed";
const NONE = "";
const emptyRow: Row = { notesFrom: NONE, videosFrom: NONE, questionsFrom: NONE, answered: "", accuracy: "", confidence: 0 };

function rowFrom(d: Declaration): Row {
  return {
    notesFrom: d.notesFrom ?? NONE,
    videosFrom: d.videosFrom ?? NONE,
    questionsFrom: d.questions ? (d.questions.from ?? UNATTRIBUTED) : NONE,
    answered: d.questions ? String(d.questions.answered) : "",
    accuracy: d.questions?.accuracyPercent != null ? String(d.questions.accuracyPercent) : "",
    confidence: d.confidence ?? 0,
  };
}

function declares(row: Row): boolean {
  return row.notesFrom !== NONE || row.videosFrom !== NONE || row.questionsFrom !== NONE || row.confidence > 0;
}

function toDeclaration(topicId: string, readingId: string | null, row: Row): Declaration {
  const answered = Number(row.answered) || 0;
  const source = (v: string) => (v === NONE ? null : v);
  return {
    topicId,
    readingId,
    notesFrom: source(row.notesFrom),
    videosFrom: source(row.videosFrom),
    questions:
      row.questionsFrom === NONE
        ? null
        : {
            from: row.questionsFrom === UNATTRIBUTED ? null : row.questionsFrom,
            answered,
            accuracyPercent: answered > 0 && row.accuracy !== "" ? Number(row.accuracy) : null,
          },
    confidence: row.confidence > 0 ? row.confidence : null,
  };
}

function SourceSelect({
  id,
  label,
  value,
  sources,
  none,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  sources: Source[];
  none: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel} htmlFor={id}>
        {label}
      </label>
      <select id={id} className={styles.select} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        <option value={NONE}>{none}</option>
        {sources.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
        {value === UNATTRIBUTED ? <option value={UNATTRIBUTED}>Source not given</option> : null}
      </select>
    </div>
  );
}

function RowControls({
  idBase,
  row,
  sources,
  disabled,
  onChange,
}: {
  idBase: string;
  row: Row;
  sources: Record<SourceKind, Source[]>;
  disabled: boolean;
  onChange: (patch: Partial<Row>) => void;
}) {
  const asking = row.questionsFrom !== NONE;
  const answered = Number(row.answered) || 0;
  return (
    <div className={styles.controls}>
      <SourceSelect
        id={`${idBase}-notes`}
        label="Notes read"
        value={row.notesFrom}
        sources={sources.notes}
        none="Not yet"
        disabled={disabled}
        onChange={(notesFrom) => onChange({ notesFrom })}
      />
      {sources.videos.length > 0 || row.videosFrom !== NONE ? (
        <SourceSelect
          id={`${idBase}-videos`}
          label="Videos watched"
          value={row.videosFrom}
          sources={sources.videos}
          none="Not yet"
          disabled={disabled}
          onChange={(videosFrom) => onChange({ videosFrom })}
        />
      ) : null}
      <SourceSelect
        id={`${idBase}-questions`}
        label="Questions from"
        value={row.questionsFrom}
        sources={sources.questions}
        none="None yet"
        disabled={disabled}
        onChange={(questionsFrom) => onChange({ questionsFrom })}
      />
      {asking ? (
        <>
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor={`${idBase}-answered`}>
              Answered
            </label>
            <input
              className={styles.number}
              id={`${idBase}-answered`}
              type="number"
              inputMode="numeric"
              min={0}
              max={100000}
              step={1}
              placeholder="0"
              value={row.answered}
              disabled={disabled}
              onChange={(e) => onChange({ answered: e.target.value })}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor={`${idBase}-accuracy`}>
              About how many right
            </label>
            <div className={styles.percentWrap}>
              <input
                className={styles.number}
                id={`${idBase}-accuracy`}
                type="number"
                inputMode="numeric"
                min={0}
                max={100}
                step={1}
                placeholder="70"
                value={row.accuracy}
                disabled={disabled || answered === 0}
                onChange={(e) => onChange({ accuracy: e.target.value })}
              />
              <span className={styles.percent}>%</span>
            </div>
          </div>
        </>
      ) : null}
      <div className={styles.field}>
        <span className={styles.fieldLabel} id={`${idBase}-confidence`}>
          Confidence
        </span>
        <div className={styles.confidence}>
          <ConfidencePicker
            name={`${idBase}-confidence`}
            legend="Confidence"
            value={row.confidence}
            onChange={(confidence) => onChange({ confidence })}
          />
          {row.confidence > 0 ? (
            <button type="button" className={styles.textButton} disabled={disabled} onClick={() => onChange({ confidence: 0 })}>
              Clear
            </button>
          ) : (
            <span className={styles.hint}>Not rated</span>
          )}
        </div>
      </div>
    </div>
  );
}

function TopicRow({
  topic,
  rows,
  overrides,
  sources,
  disabled,
  update,
  setOverride,
}: {
  topic: Topic;
  rows: Record<string, Row>;
  overrides: Set<string>;
  sources: Record<SourceKind, Source[]>;
  disabled: boolean;
  update: (key: string, patch: Partial<Row>) => void;
  setOverride: (readingId: string, on: boolean) => void;
}) {
  const modules = topic.readings.slice().sort((a, b) => a.order - b.order);
  const ownCount = modules.filter((m) => overrides.has(m.id)).length;
  const [open, setOpen] = useState(ownCount > 0);
  const panelId = `prior-modules-${topic.id}`;

  return (
    <li className={styles.row}>
      <fieldset className={styles.fieldset}>
        <legend className={styles.topic}>{topic.name}</legend>
        <RowControls
          idBase={`prior-${topic.id}`}
          row={rows[topic.id] ?? emptyRow}
          sources={sources}
          disabled={disabled}
          onChange={(patch) => update(topic.id, patch)}
        />
      </fieldset>

      {modules.length > 0 ? (
        <button
          type="button"
          className={styles.disclosure}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
        >
          {ownCount > 0 ? `Answer per module (${ownCount} set)` : "Answer per module"}
        </button>
      ) : null}

      {open ? (
        <ul id={panelId} className={styles.modules}>
          {modules.map((m) => {
            const own = overrides.has(m.id);
            const toggleId = `prior-own-${m.id}`;
            return (
              <li key={m.id} className={styles.module}>
                <div className={styles.check}>
                  <input
                    id={toggleId}
                    type="checkbox"
                    checked={own}
                    disabled={disabled}
                    aria-describedby={`${toggleId}-what`}
                    onChange={(e) => setOverride(m.id, e.target.checked)}
                  />
                  <label htmlFor={toggleId}>{m.name}</label>
                  <span id={`${toggleId}-what`} hidden>
                    Answer for this module separately from its topic
                  </span>
                </div>
                {own ? (
                  <RowControls
                    idBase={`prior-${m.id}`}
                    row={rows[m.id] ?? emptyRow}
                    sources={sources}
                    disabled={disabled}
                    onChange={(patch) => update(m.id, patch)}
                  />
                ) : (
                  <p className={styles.hint}>Same as the topic.</p>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </li>
  );
}

export function PriorWork({ plan, onSaved }: { plan: Plan; onSaved: () => void }) {
  const curriculum = useCurriculum(plan.levelId);
  const saved = useQuery({
    queryKey: ["prior-work", plan.id],
    queryFn: () => api.get<PriorWorkData>(`plans/${plan.id}/prior-work`),
  });
  // Keyed by topic id or module (reading) id.
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [overrides, setOverrides] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!saved.data) return;
    const next: Record<string, Row> = {};
    const own = new Set<string>();
    for (const d of saved.data.declarations) {
      next[d.readingId ?? d.topicId] = rowFrom(d);
      if (d.readingId) own.add(d.readingId);
    }
    setRows(next);
    setOverrides(own);
  }, [saved.data]);

  const topics = useMemo(
    () => (curriculum.data?.topics ?? []).slice().sort((a, b) => a.order - b.order),
    [curriculum.data],
  );
  const sources = saved.data?.sources;

  const declarations = useMemo(() => {
    const out: Declaration[] = [];
    for (const topic of topics) {
      const row = rows[topic.id];
      if (row && declares(row)) out.push(toDeclaration(topic.id, null, row));
      // An overridden module is sent even when empty: it means "not this one".
      for (const m of topic.readings) {
        if (overrides.has(m.id)) out.push(toDeclaration(topic.id, m.id, rows[m.id] ?? emptyRow));
      }
    }
    return out;
  }, [topics, rows, overrides]);
  const filled = new Set(declarations.map((d) => d.topicId)).size;

  function update(key: string, patch: Partial<Row>) {
    setRows((prev) => ({ ...prev, [key]: { ...emptyRow, ...prev[key], ...patch } }));
  }

  function setOverride(readingId: string, on: boolean) {
    setOverrides((prev) => {
      const next = new Set(prev);
      if (on) next.add(readingId);
      else next.delete(readingId);
      return next;
    });
  }

  async function save() {
    setPending(true);
    try {
      await api.post(`plans/${plan.id}/prior-work`, { declarations });
      toast.success(
        declarations.length === 0
          ? "Cleared what you had already studied."
          : "Saved. The days ahead have been replanned around it.",
      );
      await saved.refetch();
      onSaved();
    } catch (err) {
      toast.error(err instanceof ApiError ? messageForStatus(err.status) : "Could not save that. Try again.");
    } finally {
      setPending(false);
    }
  }

  const loading = curriculum.isLoading || saved.isLoading;
  const failed = curriculum.isError || saved.isError;

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>What you have already studied</h2>
      <p className={styles.lede}>
        Tell the planner what you got through before it took over, or during any stretch you went
        your own way, and in which material. It stops the plan asking you to read or watch
        something twice, and counts questions you already did in a bank it would otherwise set.
      </p>

      <details className={styles.details} open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary className={styles.summary}>
          {filled === 0 ? "Add what you have done" : `${filled} of ${topics.length} topic areas filled in`}
        </summary>

        {loading && <p className={styles.note}>Loading the curriculum.</p>}

        {failed && (
          <p className={styles.note}>
            The curriculum or your saved answers did not load. Reload the page to try again.
          </p>
        )}

        {!loading && !failed && topics.length === 0 && (
          <p className={styles.note}>
            The curriculum for your level has not been loaded yet, so there is nothing to declare
            against.
          </p>
        )}

        {topics.length > 0 && sources && (
          <>
            <p className={styles.note}>
              Rough figures are fine and far better than none. Leave a topic blank if you have not
              touched it. Open a topic&apos;s modules only if some of it differs.
            </p>

            <ul className={styles.list}>
              {topics.map((topic) => (
                <TopicRow
                  key={topic.id}
                  topic={topic}
                  rows={rows}
                  overrides={overrides}
                  sources={sources}
                  disabled={pending}
                  update={update}
                  setOverride={setOverride}
                />
              ))}
            </ul>

            <div className={styles.actions}>
              <button className={styles.save} type="button" disabled={pending} onClick={save}>
                {pending ? "Saving" : "Save and replan"}
              </button>
              <p className={styles.caution}>
                This replaces whatever you declared before, rather than adding to it. Work you have
                logged inside the app is never touched.
              </p>
            </div>
          </>
        )}
      </details>
    </section>
  );
}
