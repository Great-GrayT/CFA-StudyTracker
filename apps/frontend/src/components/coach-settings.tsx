"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ApiError, messageForStatus } from "@/lib/api";
import type { CoachPreference, GeocodeMatch, Plan } from "@/lib/types";
import styles from "./coach-settings.module.css";

// The study coach, managed from Settings: how much each channel sends, and
// where the candidate studies.
//
// Two decisions shaped this.
//
// The preference is a three-way choice, not a switch. What replaced it was a
// toggle labelled "Missed day alerts" wired to component state, so it reset on
// every reload and controlled nothing at all. A switch cannot express "all
// three / night only / off", and reaching for one is how that happened.
//
// The city lookup returns a list and makes the candidate pick. There is a
// Manchester in England and one in New Hampshire, and guessing wrong would put
// both their weather lines and, far worse, their delivery times on the wrong
// continent, with nothing downstream able to notice.

const CHOICES: { value: CoachPreference; label: string }[] = [
  { value: "all", label: "All three" },
  // "debrief" is the system's word for it. Nobody outside this codebase calls
  // the end of their day a debrief.
  { value: "debrief-only", label: "Night only" },
  { value: "off", label: "Off" },
];

/**
 * One channel's three-way preference.
 *
 * Native radios inside a fieldset, not styled buttons. An earlier version used
 * three `<button role="radio">` elements in a `role="radiogroup"`, which
 * announces a pattern it did not implement: a radiogroup is a SINGLE tab stop
 * whose options are reached with the arrow keys, and three buttons are three
 * tab stops that ignore arrows entirely. A keyboard or screen reader user was
 * being promised one interaction and given another. The platform already does
 * all of this correctly, so the input stays real and only the label is styled.
 *
 * `selected` is the value shown as active, which is the pending choice while a
 * save is in flight rather than the saved one. Without that the pill does not
 * light up until the round trip returns, and the control feels broken at
 * exactly the moment the user is looking for confirmation.
 */
function ChannelChoice({
  name,
  label,
  selected,
  pending,
  onChange,
}: {
  name: string;
  label: string;
  selected: CoachPreference;
  pending: boolean;
  onChange: (next: CoachPreference) => void;
}) {
  return (
    <fieldset className={styles.channel}>
      <legend className={styles.channelLabel}>{label}</legend>
      <div className={styles.choices}>
        {CHOICES.map((choice) => {
          const id = `${name}-${choice.value}`;
          return (
            <div key={choice.value} className={styles.choiceWrap}>
              <input
                className={styles.choiceInput}
                type="radio"
                id={id}
                name={name}
                value={choice.value}
                checked={choice.value === selected}
                disabled={pending}
                onChange={() => onChange(choice.value)}
              />
              <label className={styles.choiceLabel} htmlFor={id}>
                {choice.label}
              </label>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

export function CoachSettings({ plan, onSaved }: { plan: Plan; onSaved: () => void }) {
  const [pending, setPending] = useState(false);
  // Shown as active while the save is in flight. Cleared on failure, so a
  // rejected change snaps back to the truth rather than leaving the control
  // claiming something the server never accepted.
  const [optimistic, setOptimistic] = useState<{
    emailCoach?: CoachPreference;
    pushCoach?: CoachPreference;
  }>({});

  async function save(
    field: "emailCoach" | "pushCoach",
    next: CoachPreference,
    confirmation: string,
  ) {
    setPending(true);
    setOptimistic((prev) => ({ ...prev, [field]: next }));
    try {
      await api.patch(`plans/${plan.id}`, { [field]: next });
      toast.success(confirmation);
      onSaved();
    } catch (err) {
      setOptimistic((prev) => ({ ...prev, [field]: undefined }));
      toast.error(
        err instanceof ApiError ? messageForStatus(err.status) : "Could not save that. Try again.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Study coach</h2>
      <p className={styles.lede}>
        The coach writes you a plan each morning, a nudge in the evening if nothing is logged yet,
        and a summary at night. Each channel is set separately.
      </p>

      <ChannelChoice
        name="email-coach"
        label="Emails"
        selected={optimistic.emailCoach ?? plan.emailCoach}
        pending={pending}
        onChange={(next) =>
          save(
            "emailCoach",
            next,
            next === "off" ? "Coach emails stopped." : "Coach emails updated.",
          )
        }
      />

      <ChannelChoice
        name="push-coach"
        label="Phone notifications"
        selected={optimistic.pushCoach ?? plan.pushCoach}
        pending={pending}
        onChange={(next) =>
          save(
            "pushCoach",
            next,
            next === "off" ? "Phone notifications stopped." : "Phone notifications updated.",
          )
        }
      />

      <p className={styles.hint}>
        Both channels say the same thing. Turning one off never affects the other, and neither
        touches your plan or anything you have recorded.
      </p>

      <CoachSchedule plan={plan} />
      <CoachTryout />
    </section>
  );
}

type Slot = "prescription" | "nudge" | "debrief";
type CoachInfo = { schedule: Record<Slot, string>; timeZone: string; events: Record<Slot, string[]> };
type Preview = {
  key: string | null;
  state: { horizon: string; phase: string; streakDays: number; tasksDone: number; taskCount: number };
  message: { subject: string; text: string } | null;
  delivered?: boolean;
  reason?: string;
};

const SLOT_LABELS: Record<Slot, string> = {
  prescription: "Morning plan",
  nudge: "Evening nudge",
  debrief: "Night summary",
};
const DEFAULT_TIMES: Record<Slot, string> = { prescription: "06:30", nudge: "20:00", debrief: "22:30" };
const SLOTS: Slot[] = ["prescription", "nudge", "debrief"];

/** "P_REST_BEHIND" reads as "rest behind" under its slot's heading. */
function eventLabel(key: string): string {
  return key.slice(2).toLowerCase().replace(/_/g, " ");
}

function useCoachInfo() {
  return useQuery({ queryKey: ["coach-info"], queryFn: () => api.get<CoachInfo>("coach/preview") });
}

/** The three daily times, in the plan's own zone, saved together. */
function CoachSchedule({ plan }: { plan: Plan }) {
  const info = useCoachInfo();
  const [times, setTimes] = useState<Record<Slot, string>>(DEFAULT_TIMES);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (info.data) setTimes(info.data.schedule);
  }, [info.data]);

  async function save(next: Record<Slot, string> | null) {
    const check = next ?? DEFAULT_TIMES;
    // HH:MM strings compare correctly as text.
    if (!(check.prescription < check.nudge && check.nudge < check.debrief)) {
      setError("Keep them in order: morning, then evening, then night.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await api.patch(`plans/${plan.id}`, { coachSchedule: next });
      await info.refetch();
      toast.success(next ? "Coach times saved." : "Coach times reset.");
    } catch (err) {
      toast.error(err instanceof ApiError ? messageForStatus(err.status) : "Could not save that. Try again.");
    } finally {
      setSaving(false);
    }
  }

  const zone = info.data?.timeZone;
  return (
    <fieldset className={styles.channel}>
      <legend className={styles.channelLabel}>When it writes</legend>
      <div className={styles.times}>
        {SLOTS.map((slot) => (
          <label key={slot} className={styles.time}>
            <span>{SLOT_LABELS[slot]}</span>
            <input
              type="time"
              className={styles.timeInput}
              value={times[slot]}
              disabled={saving || !info.data}
              aria-invalid={error ? true : undefined}
              onChange={(e) => setTimes((prev) => ({ ...prev, [slot]: e.target.value }))}
            />
          </label>
        ))}
      </div>
      {zone ? (
        <p className={styles.hint}>
          {zone === "UTC"
            ? "These times are in UTC, because no city is set. Choose your city below and they follow your own clock."
            : `These times are in ${zone}.`}
        </p>
      ) : null}
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      <div className={styles.row}>
        <button type="button" className={styles.button} disabled={saving || !info.data} onClick={() => save(times)}>
          {saving ? "Saving" : "Save times"}
        </button>
        <button type="button" className={styles.textButton} disabled={saving} onClick={() => save(null)}>
          Reset to defaults
        </button>
      </div>
    </fieldset>
  );
}

/** Read any message the coach can send, with your real numbers, and optionally receive it. */
function CoachTryout() {
  const info = useCoachInfo();
  const [target, setTarget] = useState("slot:prescription");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(deliver?: "email" | "push") {
    const [kind, value] = target.split(":") as ["slot" | "key", string];
    setBusy(true);
    try {
      const body = await api.post<Preview>("coach/preview", {
        [kind]: value,
        ...(deliver ? { deliver } : {}),
      });
      setPreview(body);
      if (deliver && body.delivered) {
        toast.success(deliver === "email" ? "Sent to your email." : "Sent to your phone.");
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not reach the coach. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <fieldset className={styles.channel}>
      <legend className={styles.channelLabel}>Try a message</legend>
      <p className={styles.hint}>
        Shows what the coach would say, worked out from your plan right now. Nothing is recorded as
        sent, so the real message later today still goes out.
      </p>
      <label className={styles.time} htmlFor="coach-tryout">
        <span>Message</span>
        <select
          id="coach-tryout"
          className={styles.select}
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        >
          <optgroup label="What it would send now">
            {SLOTS.map((slot) => (
              <option key={slot} value={`slot:${slot}`}>
                {SLOT_LABELS[slot]}
              </option>
            ))}
          </optgroup>
          {info.data
            ? SLOTS.map((slot) => (
                <optgroup key={slot} label={`${SLOT_LABELS[slot]}, any event`}>
                  {info.data.events[slot].map((key) => (
                    <option key={key} value={`key:${key}`}>
                      {eventLabel(key)}
                    </option>
                  ))}
                </optgroup>
              ))
            : null}
        </select>
      </label>
      <div className={styles.row}>
        <button type="button" className={styles.button} disabled={busy} onClick={() => run()}>
          Show message
        </button>
        <button type="button" className={styles.textButton} disabled={busy} onClick={() => run("email")}>
          Email it to me
        </button>
        <button type="button" className={styles.textButton} disabled={busy} onClick={() => run("push")}>
          Send to my phone
        </button>
      </div>
      <div aria-live="polite">
        {preview ? (
          <div className={styles.preview}>
            <p className={styles.hint}>
              {preview.key ? `Event: ${eventLabel(preview.key)}. ` : ""}
              {`Streak ${preview.state.streakDays}, ${preview.state.tasksDone} of ${preview.state.taskCount} tasks recorded today.`}
            </p>
            {preview.message ? (
              <>
                <p className={styles.previewSubject}>{preview.message.subject}</p>
                <p className={styles.previewBody}>{preview.message.text}</p>
              </>
            ) : (
              <p className={styles.lede}>
                The coach would send nothing for this right now. The evening nudge, for one, stays
                quiet once you have recorded study today.
              </p>
            )}
          </div>
        ) : null}
      </div>
    </fieldset>
  );
}

export function LocationSettings({ plan, onSaved }: { plan: Plan; onSaved: () => void }) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<GeocodeMatch[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = query.trim();
    if (trimmed.length < 2) return;

    setSearching(true);
    setMatches(null);
    try {
      const body = await api.get<{ results: GeocodeMatch[] }>(
        `geocode?q=${encodeURIComponent(trimmed)}`,
      );
      setMatches(body.results);
    } catch {
      // An unreachable lookup and an unknown place are the same thing from
      // here, and the empty state below says so without guessing which.
      setMatches([]);
    } finally {
      setSearching(false);
    }
  }

  async function choose(match: GeocodeMatch) {
    setSaving(true);
    try {
      await api.patch(`plans/${plan.id}`, {
        location: {
          city: match.city,
          countryCode: match.countryCode,
          latitude: match.latitude,
          longitude: match.longitude,
          timeZone: match.timeZone,
        },
      });
      toast.success(`Studying in ${match.city}. Times set to ${match.timeZone}.`);
      setMatches(null);
      setQuery("");
      onSaved();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? messageForStatus(err.status) : "Could not save that. Try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function clear() {
    setSaving(true);
    try {
      // The zone is deliberately left alone. Email times silently moving to UTC
      // as a side effect of a privacy choice would be a nasty surprise.
      await api.patch(`plans/${plan.id}`, { location: null });
      toast.success("Location removed.");
      onSaved();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? messageForStatus(err.status) : "Could not save that. Try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Where you study</h2>
      <p className={styles.lede}>
        Your city sets the times the coach writes to you, and lets it mention the weather where you
        actually are. City only, and only what you type here.
      </p>

      {plan.city ? (
        <div className={styles.current}>
          <p className={styles.currentPlace}>
            {plan.city}
            {plan.countryCode ? `, ${plan.countryCode}` : ""}
          </p>
          <p className={styles.hint}>Messages are timed to {plan.timeZone}.</p>
          <button
            type="button"
            className={styles.quietButton}
            disabled={saving}
            onClick={clear}
          >
            Remove location
          </button>
        </div>
      ) : (
        <p className={styles.hint}>
          No city set. Messages are timed to {plan.timeZone}.
        </p>
      )}

      <form className={styles.searchRow} onSubmit={search}>
        <label className={styles.searchLabel} htmlFor="city-search">
          {plan.city ? "Change city" : "Your city"}
        </label>
        <div className={styles.searchControls}>
          <input
            id="city-search"
            className={styles.input}
            type="text"
            value={query}
            placeholder="Manchester"
            autoComplete="address-level2"
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            type="submit"
            className={styles.findButton}
            disabled={searching || query.trim().length < 2}
          >
            {searching ? "Finding" : "Find"}
          </button>
        </div>
      </form>

      {matches !== null &&
        (matches.length === 0 ? (
          <p className={styles.hint}>
            Nothing found for that. Try the nearest larger town, or check the spelling.
          </p>
        ) : (
          <ul className={styles.matches}>
            {matches.map((match) => (
              <li key={`${match.latitude},${match.longitude}`}>
                <button
                  type="button"
                  className={styles.match}
                  disabled={saving}
                  onClick={() => choose(match)}
                >
                  <span className={styles.matchPlace}>
                    {[match.city, match.admin1, match.countryCode].filter(Boolean).join(", ")}
                  </span>
                  <span className={styles.matchZone}>{match.timeZone}</span>
                </button>
              </li>
            ))}
          </ul>
        ))}
    </section>
  );
}
