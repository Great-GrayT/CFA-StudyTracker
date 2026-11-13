"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api, ApiError, messageForStatus } from "@/lib/api";
import type {
  Plan,
  PlanMode,
  PlannerSettings as PlannerData,
  ReviewPolicy,
  TuningNumbers,
} from "@/lib/types";
import styles from "./planner-settings.module.css";

// How the plan is built, managed from Settings.
//
// Three tiers, ordered by how confidently a candidate touches them.
//
// The two choices come first, because they are the feature: which order the
// reading follows, and when review starts. Both save on selection, matching the
// coach settings beside them.
//
// What the plan is doing comes second, and it is the part that makes the rest
// mean anything. The engine computes several figures nothing else in the app can
// show: the practice ratio the calendar can actually afford as against the one
// that was asked for, when the first read-through is projected to finish, and
// how much of a day review is currently allowed. These are written as sentences
// with the figures inside them rather than as a row of stat tiles, because a
// tile reads "1.6" and a sentence says what 1.6 costs you.
//
// The sixteen constants come last, behind a disclosure, grouped by what they
// govern. The specification this was built from names "a settings screen with
// twenty numbers on it and no indication of what any of them do" as an outright
// failure, so every one carries a plain-language label and a line saying what
// moving it does.

const MODES: { value: PlanMode; label: string; detail: string }[] = [
  {
    value: "curriculum-topic",
    label: "Curriculum order",
    detail:
      "Follows the curriculum, one topic area at a time. Only review departs from it, and only when your scores say so.",
  },
  {
    value: "curriculum-strict",
    label: "Strict curriculum",
    detail:
      "A fixed sequence you could print and pin up. Nothing reorders it, whatever your scores say.",
  },
  {
    value: "effort-return",
    label: "Effort and return",
    detail:
      "The original ordering, by study phase and by what each hour buys you. Kept so you can switch back and compare.",
  },
];

const POLICIES: { value: ReviewPolicy; label: string; detail: string }[] = [
  {
    value: "decay-triggered",
    label: "When scores slip",
    detail:
      "Reading comes first. A topic comes back the moment its score drops or you rate it low, and backs off if that would put the first read-through at risk.",
  },
  {
    value: "after-coverage",
    label: "After the first read-through",
    detail: "Nothing is revisited until every reading has been done once.",
  },
  {
    value: "weekly-interleave",
    label: "A slice of every week",
    detail: "A fixed share of each week goes to your weakest topics, from the first week on.",
  },
  {
    value: "fixed-date",
    label: "From a date you pick",
    detail:
      "Reading up to the date, review after it. Anything unread by then is folded into review.",
  },
];

type FieldKind = "count" | "percent" | "weight";

type Field = {
  key: keyof TuningNumbers;
  label: string;
  detail: string;
  kind: FieldKind;
  unit?: string;
  step?: number;
};

const GROUPS: { title: string; note?: string; fields: Field[] }[] = [
  {
    title: "Pacing",
    note: "Reading comes with its practice in the same sitting. These set how much.",
    fields: [
      {
        key: "firstPassQuestionMultiple",
        label: "Minutes of questions per minute of reading",
        detail: "At 2, twenty minutes of reading is followed by forty of questions.",
        kind: "count",
        step: 0.1,
      },
      {
        key: "minNewUnitReadMinutes",
        label: "Shortest first sitting on a new reading",
        detail:
          "A reading is not started for less than this. Anything shorter waits for a bigger day.",
        kind: "count",
        unit: "min",
        step: 1,
      },
      {
        key: "answerReviewWordsPerMinute",
        label: "How fast you read worked answers",
        detail:
          "Sizes the answer review after each question set. At 200, eight questions get about 12 minutes of review. Lower it if you rework the calculations.",
        kind: "count",
        unit: "words a minute",
        step: 10,
      },
      {
        key: "questionMultipleFloor",
        label: "Lowest ratio worth planning",
        detail: "Below this your calendar is too short, and the plan says so rather than pretending.",
        kind: "count",
        step: 0.1,
      },
    ],
  },
  {
    title: "Review",
    note: "Review drops the pairing: its reading and its questions run on their own, to a weekly budget.",
    fields: [
      {
        key: "reviewQuestionMultiple",
        label: "Minutes of questions per minute of review",
        detail: "Held across the week, so a single day may be all questions.",
        kind: "count",
        step: 0.1,
      },
      {
        key: "coverageDeadlineWeeks",
        label: "Weeks clear of the exam the first read-through must finish",
        detail: "Review is throttled as this deadline comes into reach.",
        kind: "count",
        unit: "weeks",
        step: 1,
      },
      {
        key: "reviewInjectionCapShare",
        label: "Most of a day review may take",
        detail: "Only under the policy that watches your scores.",
        kind: "percent",
      },
      {
        key: "weeklyInterleaveShare",
        label: "Share of each week given to review",
        detail: "Only under the policy that takes a slice of every week.",
        kind: "percent",
      },
    ],
  },
  {
    title: "What counts as learned",
    note: "Every reading carries a score from 0 to 1, built from how accurate you were, how much of the question bank you got through, how you rated yourself, and how long ago.",
    fields: [
      {
        key: "masteryWeightAccuracy",
        label: "How much accuracy counts",
        detail: "Set in whatever units you like. The three are scaled to add up to 1.",
        kind: "weight",
      },
      {
        key: "masteryWeightCoverage",
        label: "How much coverage counts",
        detail: "Questions answered against questions available.",
        kind: "weight",
      },
      {
        key: "masteryWeightConfidence",
        label: "How much your own rating counts",
        detail: "Set this to zero to keep your ratings out of the plan entirely.",
        kind: "weight",
      },
      {
        key: "masteryHalfLifeDays",
        label: "Days before a score is worth half as much",
        detail: "What you nailed in January is worth half as much by the time this many days pass.",
        kind: "count",
        unit: "days",
        step: 1,
      },
      {
        key: "masteryBar",
        label: "Score that counts as learned",
        detail: "Below this, a reading is due for review.",
        kind: "percent",
      },
      {
        key: "readingWriteOffBar",
        label: "Score that lets you skip the reading",
        detail:
          "If your questions alone clear this, the reading is dropped: you clearly know it already.",
        kind: "percent",
      },
    ],
  },
  {
    title: "What counts as evidence",
    note: "A reading may jump the queue, but only on evidence that it is genuinely weak rather than merely new.",
    fields: [
      {
        key: "confidenceTriggerValue",
        label: "Your rating that flags a reading",
        detail: "On the 1 to 5 scale you give when you finish a question set.",
        kind: "count",
        step: 1,
      },
      {
        key: "accuracyFloor",
        label: "Accuracy below which a reading is flagged",
        detail: "Counted only once you have answered enough questions to mean something.",
        kind: "percent",
      },
      {
        key: "accuracyMinSample",
        label: "Questions needed before accuracy counts",
        detail: "Stops one bad vignette from rearranging your plan.",
        kind: "count",
        unit: "questions",
        step: 1,
      },
    ],
  },
];

const NUMBER_KEYS = GROUPS.flatMap((g) => g.fields.map((f) => f.key));
const FIELD_BY_KEY = new Map(GROUPS.flatMap((g) => g.fields).map((f) => [f.key, f]));

/**
 * Percent fields are SHOWN in whole percent and STORED as a fraction, so the
 * two have to be converted at every boundary. Skipping this sent 75 where the
 * engine wanted 0.75, which parseTuning then clamped to the top of the range
 * and reported as rejected, so the slider appeared to do nothing.
 */
function toStored(key: keyof TuningNumbers, shown: string): number {
  const value = Number(shown);
  if (!Number.isFinite(value)) return Number.NaN;
  return FIELD_BY_KEY.get(key)?.kind === "percent" ? value / 100 : value;
}

function toShown(key: keyof TuningNumbers, stored: number): string {
  return FIELD_BY_KEY.get(key)?.kind === "percent"
    ? String(Math.round(stored * 100))
    : String(stored);
}

const dates = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long" });

function formatRatio(value: number): string {
  return `1 to ${value.toFixed(value < 10 ? 1 : 0)}`;
}

function formatDate(iso: string): string {
  return dates.format(new Date(`${iso}T00:00:00Z`));
}

/** One three-or-four-way choice, as native radios with styled labels. */
function Choice<T extends string>({
  name,
  legend,
  options,
  selected,
  pending,
  onChange,
}: {
  name: string;
  legend: string;
  options: { value: T; label: string; detail: string }[];
  selected: T;
  pending: boolean;
  onChange: (next: T) => void;
}) {
  return (
    <fieldset className={styles.choiceSet}>
      <legend className={styles.legend}>{legend}</legend>
      <div className={styles.options}>
        {options.map((option) => {
          const id = `${name}-${option.value}`;
          return (
            <div key={option.value} className={styles.option}>
              <input
                className={styles.radio}
                type="radio"
                id={id}
                name={name}
                value={option.value}
                checked={option.value === selected}
                disabled={pending}
                onChange={() => onChange(option.value)}
              />
              <label className={styles.optionLabel} htmlFor={id}>
                <span className={styles.optionName}>{option.label}</span>
                <span className={styles.optionDetail}>{option.detail}</span>
              </label>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

export function PlannerSettings({ plan, onSaved }: { plan: Plan; onSaved: () => void }) {
  const [data, setData] = useState<PlannerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Partial<Record<keyof TuningNumbers, string>>>({});
  const [startDate, setStartDate] = useState("");

  // Shown as selected while a save is in flight, so the control confirms the
  // choice at the moment the candidate looks for confirmation rather than after
  // the round trip. Cleared on failure, so a rejected change snaps back to the
  // truth instead of claiming something the server never took.
  const [optimistic, setOptimistic] = useState<{
    planMode?: PlanMode;
    reviewPolicy?: ReviewPolicy;
  }>({});

  async function load() {
    try {
      const settings = await api.get<{ planner: PlannerData | null }>("settings");
      setData(settings.planner);
      if (settings.planner?.tuning.reviewStartDate) {
        setStartDate(settings.planner.tuning.reviewStartDate);
      }
    } catch (err) {
      console.error("Failed to load planner settings:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.id]);

  const tuning = data?.tuning;

  const normalisedWeights = useMemo(() => {
    if (!tuning) return null;
    const keys = [
      "masteryWeightAccuracy",
      "masteryWeightCoverage",
      "masteryWeightConfidence",
    ] as const;
    const values = keys.map((key) => {
      const raw = draft[key];
      const parsed = raw === undefined ? tuning[key] : toStored(key, raw);
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    });
    const sum = values.reduce((a, b) => a + b, 0);
    if (sum <= 0) return null;
    return keys.map((key, i) => ({ key, share: values[i] / sum }));
  }, [draft, tuning]);

  const dirty = NUMBER_KEYS.some((key) => {
    const raw = draft[key];
    if (raw === undefined || raw === "") return false;
    const next = toStored(key, raw);
    if (!Number.isFinite(next)) return false;
    // Percent fields round-trip through whole percent, so compare at the
    // precision the control actually offers rather than exactly.
    return Math.abs(next - (tuning?.[key] ?? 0)) > 1e-9;
  });

  async function patch(body: Record<string, unknown>, confirmation: string) {
    setPending(true);
    try {
      const result = await api.patch<{ rejectedTuning?: { field: string }[] }>(
        `plans/${plan.id}`,
        body,
      );
      const rejected = result.rejectedTuning ?? [];
      if (rejected.length > 0) {
        toast.warning(
          `Saved, but ${rejected.length === 1 ? "one setting was" : `${rejected.length} settings were`} out of range and kept their previous value.`,
        );
      } else {
        toast.success(confirmation);
      }
      setDraft({});
      await load();
      onSaved();
    } catch (err) {
      setOptimistic({});
      toast.error(
        err instanceof ApiError ? messageForStatus(err.status) : "Could not save that. Try again.",
      );
    } finally {
      setPending(false);
    }
  }

  function saveNumbers() {
    const body: Record<string, number> = {};
    for (const key of NUMBER_KEYS) {
      const raw = draft[key];
      if (raw === undefined || raw === "") continue;
      const value = toStored(key, raw);
      if (Number.isFinite(value)) body[key] = value;
    }
    patch({ tuning: body }, "Planner settings saved.");
  }

  if (loading) {
    return (
      <section className={styles.section} aria-busy="true">
        <h2 className={styles.sectionTitle}>How your plan is built</h2>
        <p className={styles.lede}>Loading your planner settings.</p>
      </section>
    );
  }

  if (!data || !tuning) {
    return (
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>How your plan is built</h2>
        <p className={styles.lede}>
          These settings appear once you have an active plan.
        </p>
      </section>
    );
  }

  const mode = optimistic.planMode ?? tuning.planMode;
  const policy = optimistic.reviewPolicy ?? tuning.reviewPolicy;
  const supported = data.effectiveQuestionMultiple;
  const ratioShortfall = supported !== null && supported < data.requestedQuestionMultiple;

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>How your plan is built</h2>
      <p className={styles.lede}>
        Your plan reads the curriculum once, pairing each reading with questions on it, then keeps
        coming back to whatever your scores say is weakest.
      </p>

      <Choice
        name="plan-mode"
        legend="Reading order"
        options={MODES}
        selected={mode}
        pending={pending}
        onChange={(next) => {
          setOptimistic((prev) => ({ ...prev, planMode: next }));
          patch({ planMode: next }, "Reading order changed. The days ahead have been replanned.");
        }}
      />

      <Choice
        name="review-policy"
        legend="When review starts"
        options={POLICIES}
        selected={policy}
        pending={pending}
        onChange={(next) => {
          if (next === "fixed-date" && !startDate) {
            setOptimistic((prev) => ({ ...prev, reviewPolicy: next }));
            return;
          }
          setOptimistic((prev) => ({ ...prev, reviewPolicy: next }));
          patch(
            next === "fixed-date"
              ? { reviewPolicy: next, reviewStartDate: startDate }
              : { reviewPolicy: next },
            "Review schedule changed. The days ahead have been replanned.",
          );
        }}
      />

      {policy === "fixed-date" && (
        <div className={styles.dateRow}>
          <label className={styles.dateLabel} htmlFor="review-start-date">
            Review starts on
          </label>
          <input
            className={styles.dateInput}
            id="review-start-date"
            type="date"
            value={startDate}
            disabled={pending}
            onChange={(event) => setStartDate(event.target.value)}
          />
          <button
            className={styles.inlineSave}
            type="button"
            disabled={pending || !startDate}
            onClick={() =>
              patch(
                { reviewPolicy: "fixed-date", reviewStartDate: startDate },
                "Review start date saved.",
              )
            }
          >
            Save date
          </button>
        </div>
      )}

      <div className={styles.status}>
        <h3 className={styles.statusTitle}>What your plan is doing</h3>
        <ul className={styles.statusList}>
          <li>
            You asked for{" "}
            <span className={styles.figure}>{formatRatio(data.requestedQuestionMultiple)}</span>{" "}
            reading to questions.{" "}
            {supported === null ? (
              "How much of that your calendar affords will show once a plan has been built."
            ) : ratioShortfall ? (
              <>
                Your calendar affords{" "}
                <span className={styles.figure}>{formatRatio(supported)}</span>, so some of the
                question bank is out of reach.
              </>
            ) : (
              "Your calendar affords all of it."
            )}
          </li>

          {data.coverageProjection && (
            <li>
              Your first read-through finishes about{" "}
              <span className={styles.figure}>{formatDate(data.coverageProjection.date)}</span>,{" "}
              {data.coverageProjection.slackDays >= 0 ? (
                <>
                  <span className={styles.figure}>{data.coverageProjection.slackDays} days</span>{" "}
                  inside its deadline.
                </>
              ) : (
                <>
                  <span className={styles.figureAlarm}>
                    {Math.abs(data.coverageProjection.slackDays)} days
                  </span>{" "}
                  past its deadline, so review is being held back to let reading catch up.
                </>
              )}
            </li>
          )}

          {data.injectionCap !== null && data.reviewReason && (
            <li>
              Review is taking up to{" "}
              <span className={styles.figure}>{Math.round(data.injectionCap * 100)}%</span> of a
              day. {data.reviewReason}.
            </li>
          )}

          {data.calendarTooShort && (
            <li className={styles.warn}>
              Your weekly hours are too few to read the curriculum once before the exam, let alone
              practise it. Add hours or move the exam date.
            </li>
          )}

          {data.writeOffs.length > 0 && (
            <li>
              <span className={styles.figure}>{data.writeOffs.length}</span>{" "}
              {data.writeOffs.length === 1 ? "reading was" : "readings were"} dropped because your
              questions already showed you know the material.
            </li>
          )}

          {data.underPractised.length > 0 && (
            <li>
              <span className={styles.figure}>{data.underPractised.length}</span>{" "}
              {data.underPractised.length === 1 ? "reading has" : "readings have"} fewer questions
              available than this ratio wants, so they get what there is.
            </li>
          )}
        </ul>
      </div>

      <details className={styles.details} open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary className={styles.summary}>The numbers behind it</summary>

        <p className={styles.detailsLede}>
          Every figure the planner reads is yours to set. Anything outside its range keeps its
          previous value and tells you so, rather than costing you the rest of your changes.
        </p>

        {GROUPS.map((group) => (
          <div key={group.title} className={styles.group}>
            <h4 className={styles.groupTitle}>{group.title}</h4>
            {group.note && <p className={styles.groupNote}>{group.note}</p>}

            {group.fields.map((field) => {
              const range = data.ranges[field.key] ?? { min: 0, max: 1 };
              const current = tuning[field.key];
              const raw = draft[field.key];
              const shown = raw ?? toShown(field.key, current);
              const id = `tuning-${field.key}`;
              const normalised = normalisedWeights?.find((w) => w.key === field.key);

              return (
                <div key={field.key} className={styles.field}>
                  <div className={styles.fieldText}>
                    <label className={styles.fieldLabel} htmlFor={id}>
                      {field.label}
                    </label>
                    <p className={styles.fieldDetail}>{field.detail}</p>
                  </div>

                  <div className={styles.fieldControl}>
                    {field.kind === "percent" ? (
                      <>
                        <input
                          className={styles.slider}
                          id={id}
                          type="range"
                          min={Math.round(range.min * 100)}
                          max={Math.round(range.max * 100)}
                          step={1}
                          value={shown}
                          disabled={pending}
                          onChange={(event) =>
                            setDraft((prev) => ({ ...prev, [field.key]: event.target.value }))
                          }
                        />
                        <output className={styles.readout} htmlFor={id}>
                          {shown}%
                        </output>
                      </>
                    ) : (
                      <>
                        <input
                          className={styles.number}
                          id={id}
                          type="number"
                          inputMode="decimal"
                          min={range.min}
                          max={range.max}
                          step={field.step ?? 0.05}
                          value={shown}
                          disabled={pending}
                          onChange={(event) =>
                            setDraft((prev) => ({ ...prev, [field.key]: event.target.value }))
                          }
                        />
                        <span className={styles.unit}>
                          {normalised
                            ? `of the score`
                            : (field.unit ?? "")}
                        </span>
                      </>
                    )}
                  </div>

                  {normalised && (
                    <p className={styles.normalised}>
                      Counts for {Math.round(normalised.share * 100)}% of the score.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        ))}

        <div className={styles.actions}>
          <button
            className={styles.save}
            type="button"
            disabled={pending || !dirty}
            onClick={saveNumbers}
          >
            {pending ? "Saving" : "Save changes"}
          </button>
          <button
            className={styles.reset}
            type="button"
            disabled={pending}
            onClick={() => {
              // defaults arrive in stored units already, so no conversion.
              const body: Record<string, number> = {};
              for (const key of NUMBER_KEYS) body[key] = data.defaults[key];
              patch({ tuning: body }, "Planner settings back to their defaults.");
            }}
          >
            Back to defaults
          </button>
        </div>
      </details>
    </section>
  );
}
