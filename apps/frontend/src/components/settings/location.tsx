"use client";

import { useState } from "react";
import { toast } from "sonner";
import { api, ApiError, messageForStatus } from "@/lib/api";
import type { GeocodeMatch, Plan } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { SettingsSection } from "./section";

// The city sets the times the coach writes to you, and lets it mention the
// weather where you actually are. A lookup returns a list and the candidate
// picks one: there is a Manchester in England and one in New Hampshire, and a
// guess would put both the weather and the delivery times on the wrong continent.

const HINT = "text-muted-foreground text-[13px] leading-relaxed";

export function LocationSection({
  plan,
  planLoading,
  onSaved,
}: {
  plan: Plan | undefined;
  planLoading: boolean;
  onSaved: () => void;
}) {
  return (
    <SettingsSection
      id="location"
      title="Where you study"
      lede="Your city sets the times the coach writes to you, and lets it mention the weather where you actually are. City only, and only what you type here."
    >
      {plan ? (
        <LocationSettings plan={plan} onSaved={onSaved} />
      ) : planLoading ? (
        <Skeleton className="h-12 w-full rounded-none" />
      ) : (
        <p className={HINT}>Set a city once you have a plan.</p>
      )}
    </SettingsSection>
  );
}

function LocationSettings({ plan, onSaved }: { plan: Plan; onSaved: () => void }) {
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
      // An unreachable lookup and an unknown place look the same from here, and
      // the empty state says so without guessing which.
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
      toast.error(err instanceof ApiError ? messageForStatus(err.status) : "Could not save that. Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function clear() {
    setSaving(true);
    try {
      // The zone is left alone on purpose. Email times silently moving to UTC as
      // a side effect of a privacy choice would be a nasty surprise.
      await api.patch(`plans/${plan.id}`, { location: null });
      toast.success("Location removed.");
      onSaved();
    } catch (err) {
      toast.error(err instanceof ApiError ? messageForStatus(err.status) : "Could not save that. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {plan.city ? (
        <div className="flex flex-col gap-1">
          <p className="text-[14px] font-medium">
            {plan.city}
            {plan.countryCode ? `, ${plan.countryCode}` : ""}
          </p>
          <p className={HINT}>Messages are timed to {plan.timeZone}.</p>
          <div>
            <Button variant="ghost" size="sm" className="max-md:h-11" disabled={saving} onClick={clear}>
              Remove location
            </Button>
          </div>
        </div>
      ) : (
        <p className={HINT}>No city set. Messages are timed to {plan.timeZone}.</p>
      )}

      <form className="flex max-w-md flex-col gap-2" onSubmit={search}>
        <Label htmlFor="city-search">{plan.city ? "Change city" : "Your city"}</Label>
        <div className="flex gap-2">
          <Input
            id="city-search"
            type="text"
            value={query}
            placeholder="Manchester"
            autoComplete="address-level2"
            onChange={(e) => setQuery(e.target.value)}
            className="h-9 max-md:h-11"
          />
          <Button type="submit" variant="outline" disabled={searching || query.trim().length < 2}>
            {searching ? "Finding" : "Find"}
          </Button>
        </div>
      </form>

      {matches !== null &&
        (matches.length === 0 ? (
          <p className={HINT}>Nothing found for that. Try the nearest larger town, or check the spelling.</p>
        ) : (
          <ul className="border-border flex max-w-md flex-col border-t">
            {matches.map((match) => (
              <li key={`${match.latitude},${match.longitude}`} className="border-border border-b">
                <button
                  type="button"
                  className="hover:bg-muted flex min-h-11 w-full items-center justify-between gap-3 px-1 text-left disabled:opacity-50 md:min-h-9"
                  disabled={saving}
                  onClick={() => choose(match)}
                >
                  <span className="truncate text-[14px]">
                    {[match.city, match.admin1, match.countryCode].filter(Boolean).join(", ")}
                  </span>
                  <span className="text-muted-foreground shrink-0 text-[12px]">{match.timeZone}</span>
                </button>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}
