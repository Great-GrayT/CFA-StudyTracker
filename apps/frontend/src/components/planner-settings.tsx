"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, ApiError, messageForStatus } from "@/lib/api";
import type { Plan, PlanMode, PlannerSettings as PlannerData, ReviewPolicy } from "@/lib/types";
import styles from "./planner-settings.module.css";

// How the plan is built: reading order, when review starts, and how fast you
// read worked answers. Each choice saves on selection. The step engine owns
// everything else (pacing, hours, package order), so nothing else is tunable.

const MODES: { value: PlanMode; label: string; detail: string }[] = [
  {
    value: "curriculum-topic",
    label: "Topic by topic",
    detail: "Follows the curriculum, one topic area at a time, and may bring a weak topic forward.",
  },
  {
    value: "curriculum-strict",
    label: "Strict curriculum",
    detail: "A fixed sequence you could print and pin up. Nothing reorders it.",
  },
];

const POLICIES: { value: ReviewPolicy; label: string; detail: string }[] = [
  {
    value: "decay-triggered",
    label: "When scores slip",
    detail: "A topic comes back the moment its score drops or you rate it low.",
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
    detail: "Reading up to the date, review after it.",
  },
];

type RuleKey = "step2Multiplier" | "step4Multiplier" | "accuracyTarget" | "mockPassTarget" | "exemptionMultiplier";

const RULE_FIELDS: { key: RuleKey; label: string; unit: string; step: number; detail: string }[] = [
  {
    key: "step2Multiplier",
    label: "Step 2 question time",
    unit: "x step 1",
    step: 0.25,
    detail: "How long step 2 questions should take, as a multiple of your step 1 reading time.",
  },
  {
    key: "step4Multiplier",
    label: "Step 4 question time",
    unit: "x step 2",
    step: 0.25,
    detail: "How long step 4 questions should take, as a multiple of the step 2 time.",
  },
  {
    key: "accuracyTarget",
    label: "Accuracy to pass a step",
    unit: "%",
    step: 1,
    detail: "The share of questions you must get right in steps 2 and 4 before the step counts as passed.",
  },
  {
    key: "mockPassTarget",
    label: "Mock pass mark per topic",
    unit: "%",
    step: 1,
    detail: "A topic scoring below this in a mock exam is reopened for a retest.",
  },
  {
    key: "exemptionMultiplier",
    label: "Move on after",
    unit: "x adequate",
    step: 0.25,
    detail: "If accuracy is still short after this many times the adequate time, the step moves on with a review owed.",
  },
];

/** One two-to-four-way choice, as native radios with styled labels. */
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
  const [startDate, setStartDate] = useState("");
  const [wpm, setWpm] = useState<string | null>(null);
  const [ruleEdits, setRuleEdits] = useState<Partial<Record<RuleKey, string>>>({});

  // Shown as selected while a save is in flight, and cleared on failure so a
  // rejected change snaps back to what the server holds.
  const [optimistic, setOptimistic] = useState<{ planMode?: PlanMode; reviewPolicy?: ReviewPolicy }>({});

  async function load() {
    try {
      const settings = await api.get<{ planner: PlannerData | null }>("settings");
      setData(settings.planner);
      if (settings.planner?.tuning.reviewStartDate) setStartDate(settings.planner.tuning.reviewStartDate);
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

  async function patch(body: Record<string, unknown>, confirmation: string) {
    setPending(true);
    try {
      await api.patch(`plans/${plan.id}`, body);
      toast.success(confirmation);
      setWpm(null);
      setRuleEdits({});
      await load();
      onSaved();
    } catch (err) {
      setOptimistic({});
      toast.error(err instanceof ApiError ? messageForStatus(err.status) : "Could not save that. Try again.");
    } finally {
      setPending(false);
    }
  }

  const tuning = data?.tuning;

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
        <p className={styles.lede}>These settings appear once you have an active plan.</p>
      </section>
    );
  }

  const mode = optimistic.planMode ?? tuning.planMode;
  const policy = optimistic.reviewPolicy ?? tuning.reviewPolicy;
  const range = data.ranges.answerReviewWordsPerMinute ?? { min: 50, max: 600 };
  const wpmShown = wpm ?? String(tuning.answerReviewWordsPerMinute);
  const wpmNum = Number(wpmShown);
  const wpmValid = wpmShown !== "" && Number.isFinite(wpmNum) && wpmNum >= range.min && wpmNum <= range.max;
  const wpmDirty = wpm !== null && wpmValid && wpmNum !== tuning.answerReviewWordsPerMinute;

  const ruleState = RULE_FIELDS.map((f) => {
    const r = data.ranges[f.key] ?? { min: 0, max: 100 };
    const shown = ruleEdits[f.key] ?? String(tuning[f.key]);
    const num = Number(shown);
    const valid = shown !== "" && Number.isFinite(num) && num >= r.min && num <= r.max;
    return { ...f, range: r, shown, num, valid, edited: ruleEdits[f.key] !== undefined };
  });
  const rulesDirty = ruleState.some((f) => f.edited && f.num !== tuning[f.key]);
  const rulesValid = ruleState.every((f) => !f.edited || f.valid);
  const rulesAtDefaults = ruleState.every((f) => tuning[f.key] === data.defaults[f.key]);

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>How your plan is built</h2>
      <p className={styles.lede}>
        Pick the order your reading follows and when review begins. The plan sets pace and hours itself.
      </p>

      <Choice
        name="plan-mode"
        legend="Plan order"
        options={MODES}
        selected={mode}
        pending={pending}
        onChange={(next) => {
          setOptimistic((prev) => ({ ...prev, planMode: next }));
          patch({ planMode: next }, "Plan order changed. The days ahead have been replanned.");
        }}
      />

      <Choice
        name="review-policy"
        legend="When review starts"
        options={POLICIES}
        selected={policy}
        pending={pending}
        onChange={(next) => {
          setOptimistic((prev) => ({ ...prev, reviewPolicy: next }));
          if (next === "fixed-date" && !startDate) return;
          patch(
            next === "fixed-date" ? { reviewPolicy: next, reviewStartDate: startDate } : { reviewPolicy: next },
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
              patch({ reviewPolicy: "fixed-date", reviewStartDate: startDate }, "Review start date saved.")
            }
          >
            Save date
          </button>
        </div>
      )}

      <div className={styles.field}>
        <div className={styles.fieldText}>
          <label className={styles.fieldLabel} htmlFor="tuning-answerReviewWordsPerMinute">
            How fast you read worked answers
          </label>
          <p className={styles.fieldDetail}>
            Sizes the answer review after each question set. Lower it if you rework the calculations.
          </p>
        </div>
        <div className={styles.fieldControl}>
          <input
            className={styles.number}
            id="tuning-answerReviewWordsPerMinute"
            type="number"
            inputMode="numeric"
            min={range.min}
            max={range.max}
            step={10}
            value={wpmShown}
            disabled={pending}
            aria-invalid={wpm !== null && !wpmValid}
            onChange={(event) => setWpm(event.target.value)}
          />
          <span className={styles.unit}>words a minute</span>
        </div>
      </div>

      <fieldset className={styles.choiceSet}>
        <legend className={styles.legend}>Step rules</legend>
        {ruleState.map((f) => {
          const id = `tuning-${f.key}`;
          return (
            <div key={f.key} className={styles.field}>
              <div className={styles.fieldText}>
                <label className={styles.fieldLabel} htmlFor={id}>
                  {f.label}
                </label>
                <p className={styles.fieldDetail} id={`${id}-help`}>
                  {f.detail} Allowed {f.range.min} to {f.range.max}.
                </p>
              </div>
              <div className={styles.fieldControl}>
                <input
                  className={styles.number}
                  id={id}
                  type="number"
                  inputMode="decimal"
                  min={f.range.min}
                  max={f.range.max}
                  step={f.step}
                  value={f.shown}
                  disabled={pending}
                  aria-invalid={f.edited && !f.valid}
                  aria-describedby={`${id}-help`}
                  onChange={(event) => setRuleEdits((prev) => ({ ...prev, [f.key]: event.target.value }))}
                />
                <span className={styles.unit}>{f.unit}</span>
              </div>
            </div>
          );
        })}
      </fieldset>

      {/* One save for every number on this form, so no edit is left behind by the wrong button. */}
      <div className={styles.actions}>
        <button
          className={styles.save}
          type="button"
          disabled={pending || !(wpmDirty || rulesDirty) || (wpm !== null && !wpmValid) || !rulesValid}
          onClick={() =>
            patch(
              {
                tuning: {
                  ...(wpmDirty ? { answerReviewWordsPerMinute: wpmNum } : {}),
                  ...Object.fromEntries(ruleState.filter((f) => f.edited).map((f) => [f.key, f.num])),
                },
              },
              rulesDirty ? "Planner settings saved. The days ahead have been replanned." : "Planner settings saved.",
            )
          }
        >
          {pending ? "Saving" : "Save changes"}
        </button>
        <button
          className={styles.reset}
          type="button"
          disabled={pending || (rulesAtDefaults && tuning.answerReviewWordsPerMinute === data.defaults.answerReviewWordsPerMinute && wpm === null && Object.keys(ruleEdits).length === 0)}
          onClick={() =>
            patch(
              {
                tuning: {
                  answerReviewWordsPerMinute: data.defaults.answerReviewWordsPerMinute,
                  ...Object.fromEntries(RULE_FIELDS.map((f) => [f.key, data.defaults[f.key]])),
                },
              },
              "Planner settings back to their defaults.",
            )
          }
        >
          Back to defaults
        </button>
      </div>
    </section>
  );
}
