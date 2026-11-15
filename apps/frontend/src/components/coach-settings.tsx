"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ApiError, messageForStatus } from "@/lib/api";
import type { CoachPreference, Plan } from "@/lib/types";
import { Button } from "@/components/ui/button";

// How much each coach channel sends, and when it writes. Rendered inside the
// Coach and devices section.
//
// The preference is a three-way choice, not a switch. A toggle labelled
// "Missed day alerts" was wired to component state, so it reset on every reload
// and controlled nothing at all. A switch cannot express "all three / night
// only / off", and reaching for one is how that happened.

const CHOICES: { value: CoachPreference; label: string }[] = [
  { value: "all", label: "All three" },
  // "debrief" is the system's word for it. Nobody outside this codebase calls
  // the end of their day a debrief.
  { value: "debrief-only", label: "Night only" },
  { value: "off", label: "Off" },
];

const HINT = "text-muted-foreground text-[13px] leading-relaxed";
const LEGEND = "text-[14px] font-medium";
const FIELD = "border-border flex flex-col gap-2 border-t pt-4 first:border-t-0 first:pt-0";

/**
 * Native radios inside a fieldset, not styled buttons. A radiogroup built from
 * buttons announces a pattern it does not implement: a radio group is one tab
 * stop with arrow-key movement, and three buttons are three tab stops that
 * ignore arrows. The platform already does this correctly, so the input stays
 * real and only the label is styled.
 *
 * `selected` is the pending choice while a save is in flight, so the control
 * confirms the change at once rather than after the round trip.
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
    <fieldset className={FIELD}>
      <legend className={LEGEND}>{label}</legend>
      <div className="flex flex-wrap gap-2">
        {CHOICES.map((choice) => {
          const id = `${name}-${choice.value}`;
          const checked = choice.value === selected;
          return (
            <div key={choice.value} className="relative">
              <input
                className="peer sr-only"
                type="radio"
                id={id}
                name={name}
                value={choice.value}
                checked={checked}
                disabled={pending}
                onChange={() => onChange(choice.value)}
              />
              <label
                htmlFor={id}
                className={`flex h-9 max-md:h-11 cursor-pointer items-center border px-3 text-[13px] transition-colors peer-focus-visible:ring-ring/50 peer-focus-visible:ring-[3px] peer-disabled:cursor-not-allowed peer-disabled:opacity-50 ${
                  checked
                    ? "border-primary bg-primary/10 text-foreground font-medium"
                    : "border-border text-muted-foreground hover:text-foreground"
                } rounded-sm`}
              >
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
  // rejected change snaps back to the truth.
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
    <div className="flex flex-col gap-5">
      <p className={HINT}>
        The coach writes you a plan each morning, a nudge in the evening if nothing is logged yet,
        and a summary at night. Each channel is set separately.
      </p>

      <ChannelChoice
        name="email-coach"
        label="Emails"
        selected={optimistic.emailCoach ?? plan.emailCoach}
        pending={pending}
        onChange={(next) =>
          save("emailCoach", next, next === "off" ? "Coach emails stopped." : "Coach emails updated.")
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

      <p className={HINT}>
        Both channels say the same thing. Turning one off never affects the other, and neither
        touches your plan or anything you have recorded.
      </p>

      <CoachSchedule plan={plan} />
      <CoachTryout />
    </div>
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
const FIELD_INPUT =
  "border-input bg-background h-9 max-md:h-11 rounded-sm border px-3 text-[14px] tabular-nums focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none disabled:opacity-50";

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
    <fieldset className={FIELD}>
      <legend className={LEGEND}>When it writes</legend>
      <div className="grid gap-3 sm:grid-cols-3">
        {SLOTS.map((slot) => (
          <label key={slot} className="flex flex-col gap-1.5 text-[13px]">
            <span className="text-muted-foreground">{SLOT_LABELS[slot]}</span>
            <input
              type="time"
              className={FIELD_INPUT}
              value={times[slot]}
              disabled={saving || !info.data}
              aria-invalid={error ? true : undefined}
              onChange={(e) => setTimes((prev) => ({ ...prev, [slot]: e.target.value }))}
            />
          </label>
        ))}
      </div>
      {zone ? (
        <p className={HINT}>
          {zone === "UTC"
            ? "These times are in UTC, because no city is set. Set your city below and they follow your own clock."
            : `These times are in ${zone}.`}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-alarm-ink text-[13px]">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={saving || !info.data} onClick={() => save(times)}>
          {saving ? "Saving" : "Save times"}
        </Button>
        <Button variant="ghost" disabled={saving} onClick={() => save(null)}>
          Reset to defaults
        </Button>
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
    <fieldset className={FIELD}>
      <legend className={LEGEND}>Try a message</legend>
      <p className={HINT}>
        Shows what the coach would say, worked out from your plan right now. Nothing is recorded as
        sent, so the real message later today still goes out.
      </p>
      <label className="flex max-w-sm flex-col gap-1.5 text-[13px]" htmlFor="coach-tryout">
        <span className="text-muted-foreground">Message</span>
        <select
          id="coach-tryout"
          className={`${FIELD_INPUT} pr-8`}
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
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy} onClick={() => run()}>
          Show message
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => run("email")}>
          Email it to me
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => run("push")}>
          Send to my phone
        </Button>
      </div>
      <div aria-live="polite">
        {preview ? (
          <div className="border-border mt-1 flex flex-col gap-2 border-l pl-4">
            <p className={HINT}>
              {preview.key ? `Event: ${eventLabel(preview.key)}. ` : ""}
              {`Streak ${preview.state.streakDays}, ${preview.state.tasksDone} of ${preview.state.taskCount} tasks recorded today.`}
            </p>
            {preview.message ? (
              <>
                <p className="text-[14px] font-medium">{preview.message.subject}</p>
                <p className="font-prose text-[16px] leading-relaxed">{preview.message.text}</p>
              </>
            ) : (
              <p className="text-muted-foreground text-[14px]">
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
