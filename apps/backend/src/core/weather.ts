/**
 * Turns one day's observation for the candidate's own city into coarse tags the
 * dialogue picker can filter on. Pure: no network, no clock, no DB.
 *
 * Deliberately coarse. The coach's whole voice rests on the arithmetic under it
 * being true, so a line that says "clear and warm" during a storm costs more
 * than every weather line in the file earns. Buckets we can be confident about
 * beat precision we cannot, and nothing here forecasts: these are tags for
 * today, fetched this morning.
 *
 * Several tags can apply at once, which is correct. A cold day with sleet and a
 * four o'clock sunset is genuinely all three, and the picker only needs one of
 * a line's tags to overlap.
 */

import type { WeatherTag } from "./lines/types.ts";

export type Observation = {
  /** WMO code as returned by Open-Meteo's `weather_code`. */
  weatherCode: number;
  /** Daily maximum, degrees Celsius. */
  tempMaxC: number;
  /** Sunrise to sunset, in hours. */
  daylightHours: number;
};

/**
 * WMO code groups, named rather than inlined so a reader can check them against
 * the published table instead of trusting a magic number.
 *
 * Freezing drizzle and freezing rain (56, 57, 66, 67) are grouped with snow
 * rather than rain on purpose: for a candidate deciding whether to leave the
 * house, freezing rain behaves like snow and not like a shower.
 */
const STORM_CODES = [95, 96, 99];
const SNOW_CODES = [56, 57, 66, 67, 71, 73, 75, 77, 85, 86];
const RAIN_CODES = [51, 53, 55, 61, 63, 65, 80, 81, 82];
const CLEAR_CODES = [0, 1];

/** Degrees Celsius. Chosen to be uncontroversial rather than clever. */
const HEAT_C = 30;
const WARM_C = 20;
const COLD_C = 3;

/**
 * Below this, the evening is dark before most people have finished work, which
 * predicts an evening at the desk better than any amount of rain. Roughly the
 * UK in November, or Scandinavia for a third of the year.
 */
const DARK_DAY_HOURS = 9.5;

export function weatherTags(obs: Observation): WeatherTag[] {
  const tags: WeatherTag[] = [];

  // Conditions. Storm outranks its own precipitation: a thunderstorm reported
  // as "rain" would be the coach underselling what the candidate can see.
  if (STORM_CODES.includes(obs.weatherCode)) {
    tags.push("storm");
  } else if (SNOW_CODES.includes(obs.weatherCode)) {
    tags.push("snow");
  } else if (RAIN_CODES.includes(obs.weatherCode)) {
    tags.push("rain");
  }

  // Temperature, independent of conditions. `clear-warm` needs both a clear sky
  // and real warmth, because that is the specific combination that empties a
  // desk: a warm overcast day does not pull anybody outdoors.
  if (obs.tempMaxC >= HEAT_C) {
    tags.push("heat");
  } else if (obs.tempMaxC <= COLD_C) {
    tags.push("cold");
  }
  if (CLEAR_CODES.includes(obs.weatherCode) && obs.tempMaxC >= WARM_C) {
    tags.push("clear-warm");
  }

  if (obs.daylightHours < DARK_DAY_HOURS) {
    tags.push("dark-early");
  }

  return tags;
}
