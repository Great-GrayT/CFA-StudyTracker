"use client";

import { useMemo, useState } from "react";
import { STAGES, periodTotal, type Campaign, type CampaignStage } from "@/lib/campaign-types";
import styles from "./campaign-chart.module.css";

/**
 * The whole run to the exam, one stacked bar per period.
 *
 * Stacked rather than grouped because the question is "what does this week
 * consist of", and the total height answers "how heavy is it" at the same
 * time. Four study stages carry colour; mock exams are a hatched cap,
 * because a mock is an event that punctuates the plan rather than a stage of
 * it, and because five fills could not clear the colour checks in the dark
 * theme's narrow lightness band.
 *
 * A mid-plan period showing all four stages at once is correct, not a glitch:
 * the engine's default review policy injects review into first-pass days as
 * soon as a unit's mastery decays, so the phases genuinely overlap.
 */

const SEG_CLASS: Record<Exclude<CampaignStage, "mocks">, string> = {
  firstPassReading: styles.segFpReading,
  firstPassQuestions: styles.segFpQuestions,
  reviewReading: styles.segRvReading,
  reviewQuestions: styles.segRvQuestions,
};

const SWATCH_VAR: Record<Exclude<CampaignStage, "mocks">, string> = {
  firstPassReading: "var(--stage-fp-reading)",
  firstPassQuestions: "var(--stage-fp-questions)",
  reviewReading: "var(--stage-rv-reading)",
  reviewQuestions: "var(--stage-rv-questions)",
};

function hours(minutes: number): string {
  if (minutes <= 0) return "0";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = minutes / 60;
  return `${h % 1 === 0 ? h : h.toFixed(1)} hr`;
}

function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export function CampaignChart({ campaign }: { campaign: Campaign | undefined }) {
  const [active, setActive] = useState<number | null>(null);

  const ceiling = useMemo(() => {
    if (!campaign) return 0;
    return Math.max(60, ...campaign.periods.map(periodTotal));
  }, [campaign]);

  if (!campaign || campaign.periods.length === 0) {
    return (
      <section className={styles.wrap} aria-labelledby="campaign">
        <h2 id="campaign" className={styles.heading}>
          The whole run
        </h2>
        <p className={styles.empty}>
          The long view is built from the planner, and it has not produced one for this plan
          yet. It appears here once there is a plan to project.
        </p>
      </section>
    );
  }

  // Defaults to the period the candidate is in, not the last one. The last
  // is usually empty on a plan that finishes early, so the readout opened
  // saying "0" about a week in May.
  const shown = active ?? 0;
  const period = campaign.periods[shown];
  const total = periodTotal(period);

  // Label roughly every fourth period, so the axis stays readable over a
  // thirty week span instead of turning into a grey smear.
  const labelEvery = Math.max(1, Math.ceil(campaign.periods.length / 8));

  const hasMocks = campaign.periods.some((p) => (p.minutes.mocks ?? 0) > 0);

  const shortfall =
    campaign.calendarTooShort ||
    campaign.budgetQuestionMultiple < campaign.requestedQuestionMultiple - 0.05;

  return (
    <section className={styles.wrap} aria-labelledby="campaign">
      <div className={styles.head}>
        <h2 id="campaign" className={styles.heading}>
          The whole run
        </h2>
        <p className={styles.caption}>
          {campaign.periods.length} periods to {shortDate(campaign.examDate)}
        </p>
      </div>

      {/* The two things the engine knows and nothing else on the screen would
          show: when the first pass is projected to land, and whether the
          practice ratio the candidate asked for is actually reachable. */}
      {campaign.coverageProjection ? (
        <p className={styles.caption}>
          First pass projected to finish {shortDate(campaign.coverageProjection.date)},
          {campaign.coverageProjection.slackDays >= 0
            ? ` ${campaign.coverageProjection.slackDays} days before the exam.`
            : ` ${Math.abs(campaign.coverageProjection.slackDays)} days after the exam.`}
        </p>
      ) : null}

      {shortfall ? (
        <p className={styles.captionWarn}>
          {campaign.calendarTooShort
            ? "There is not enough time left for this plan at the ratio you set. "
            : ""}
          Running at 1:{campaign.budgetQuestionMultiple.toFixed(1)} reading to questions, not
          the 1:{campaign.requestedQuestionMultiple.toFixed(1)} you asked for.
        </p>
      ) : null}

      <div className={styles.plotWrap}>
        <div
          className={styles.plot}
          role="img"
          aria-label={`Minutes per period from now to the exam, split by study stage. ${campaign.periods.length} periods.`}
        >
          {campaign.periods.map((p, i) => (
            <button
              key={p.start}
              type="button"
              className={styles.col}
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onClick={() => setActive(i)}
              aria-label={`${shortDate(p.start)} to ${shortDate(p.end)}, ${hours(periodTotal(p))}`}
            >
              {STAGES.filter((s) => s.key !== "mocks").map((s) => {
                const m = p.minutes[s.key] ?? 0;
                if (m <= 0) return null;
                return (
                  <span
                    key={s.key}
                    className={`${styles.seg} ${SEG_CLASS[s.key as Exclude<CampaignStage, "mocks">]}`}
                    style={{ height: `${(m / ceiling) * 100}%` }}
                  />
                );
              })}
              {(p.minutes.mocks ?? 0) > 0 ? <span className={styles.mockCap} /> : null}
            </button>
          ))}
        </div>

        <div className={styles.axis} aria-hidden="true">
          {campaign.periods.map((p, i) => (
            <span
              key={p.start}
              className={`${styles.tick} ${
                i === 0
                  ? styles.tickFirst
                  : i === campaign.periods.length - 1
                    ? styles.tickLast
                    : ""
              }`}
            >
              {i % labelEvery === 0 ? <span>{shortDate(p.start)}</span> : null}
            </span>
          ))}
        </div>
      </div>

      {/* A fixed readout rather than a floating tooltip: a phone has no
          hover, and a tooltip would cover the bar it describes. */}
      <div className={styles.readout} aria-live="polite">
        <p className={styles.readoutHead}>
          {shortDate(period.start)} to {shortDate(period.end)} · {hours(total)}
        </p>
        <dl className={styles.readoutRows}>
          {STAGES.map((s) => {
            const m = period.minutes[s.key] ?? 0;
            if (m <= 0) return null;
            return (
              <div key={s.key} className={styles.readoutRow}>
                <dt>
                  <span
                    className={styles.swatch}
                    style={
                      s.key === "mocks"
                        ? { background: "var(--text)" }
                        : { background: SWATCH_VAR[s.key as Exclude<CampaignStage, "mocks">] }
                    }
                    aria-hidden="true"
                  />
                  {s.phase}: {s.label}
                </dt>
                <dd className="tnum">{hours(m)}</dd>
              </div>
            );
          })}
        </dl>
      </div>

      {/* Said plainly rather than left for someone to discover: the engine
          counts a logged mock as a flat three hours because MockExam stores
          a score and a date and never a duration. The band is real, its
          height is nominal. */}
      {hasMocks ? (
        <p className={styles.caption}>
          Mock exams are counted at a nominal 3 hours each; the app does not record how
          long one actually took.
        </p>
      ) : null}

      {/* Grouped by phase, because the pairing is what the chart is for. */}
      <dl className={styles.legend}>
        {["First pass", "Review", "Mocks"].map((phase) => (
          <div key={phase} className={styles.legendGroup}>
            <dt className={styles.legendPhase}>{phase}</dt>
            {STAGES.filter((s) => s.phase === phase).map((s) => (
              <dd key={s.key} className={styles.legendGroup}>
                <span
                  className={s.key === "mocks" ? styles.mockCap : styles.swatch}
                  style={
                    s.key === "mocks"
                      ? { width: 14, height: 8 }
                      : { background: SWATCH_VAR[s.key as Exclude<CampaignStage, "mocks">] }
                  }
                  aria-hidden="true"
                />
                {s.label}
              </dd>
            ))}
          </div>
        ))}
      </dl>
    </section>
  );
}
