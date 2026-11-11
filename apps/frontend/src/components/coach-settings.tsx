"use client";

import { useState } from "react";
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
        touches your plan or anything you have logged.
      </p>
    </section>
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
