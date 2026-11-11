/**
 * Local weather for the coach's copy.
 *
 * Source: Open-Meteo. No API key, free, and it returns the daily maximum, the
 * WMO condition code and the daylight duration in one request. Honest caveat
 * for whoever reads this later: their free tier is for non-commercial use, so
 * monetising this app means moving to their paid plan or swapping the provider.
 * Everything above the `getJson` boundary is provider-agnostic.
 *
 * Design rule that governs this whole file: WEATHER MAY NEVER BLOCK AN EMAIL.
 * The forecast service will be unreachable some mornings, a candidate may not
 * have told us where they are, and neither is an error. Every function here
 * returns null on any disappointment and the caller carries on with untagged
 * copy. There is exactly one `throw` in this file and it is in the pure parser,
 * where a caller is expected to catch it.
 *
 * The parsing is deliberately split from the fetching so the interesting half
 * is testable without a network: `parseForecast` and `parseGeocode` are pure,
 * and `observationFor` is a thin shell around them.
 */

import { db } from "./db";
import type { Observation } from "../core/weather.ts";

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";

/**
 * Hard ceiling on how long the coach will wait for weather. The prescription
 * email goes out at half past six and being late is worse than being plain, so
 * this is short on purpose.
 */
const TIMEOUT_MS = 4000;

export type GeocodeResult = {
  city: string;
  countryCode: string;
  latitude: number;
  longitude: number;
  /**
   * IANA zone for the place, which the candidate's plan also needs and which
   * nothing else in the app currently sets. Coming from the same lookup means
   * choosing a city sets the zone correctly instead of leaving it on UTC and
   * mailing somebody in Sydney at half past six London time.
   */
  timeZone: string;
  /** Region or state, where the provider gives one. Only for disambiguating. */
  admin1: string | null;
};

/**
 * Two decimals, roughly a kilometre. Far finer than the coarse buckets in
 * `core/weather.ts` need, and coarse enough that every candidate in one city
 * shares a single cached reading and therefore a single upstream call.
 */
export function roundToGrid(latitude: number, longitude: number): string {
  return `${latitude.toFixed(2)},${longitude.toFixed(2)}`;
}

/**
 * Pulls one day's observation out of an Open-Meteo forecast response.
 *
 * Throws on a shape it does not recognise, rather than coercing. A silent
 * fallback here would cache a junk reading for the day and the coach would
 * cheerfully describe the wrong weather, which costs more than saying nothing.
 * The only caller wraps this in a try.
 */
export function parseForecast(payload: unknown, localDate: string): Observation {
  const daily = (payload as { daily?: Record<string, unknown[]> })?.daily;
  if (!daily) throw new Error("Forecast response has no daily block");

  const dates = daily.time;
  if (!Array.isArray(dates)) throw new Error("Forecast response has no daily.time array");

  const i = dates.indexOf(localDate);
  if (i === -1) {
    throw new Error(`Forecast response does not cover ${localDate}`);
  }

  const code = daily.weather_code?.[i];
  const tempMax = daily.temperature_2m_max?.[i];
  // Open-Meteo reports daylight in seconds. Converting here rather than at the
  // call site keeps the unit mistake impossible to make twice.
  const daylightSeconds = daily.daylight_duration?.[i];

  if (typeof code !== "number" || typeof tempMax !== "number" || typeof daylightSeconds !== "number") {
    throw new Error(`Forecast response for ${localDate} is missing a field`);
  }

  return {
    weatherCode: code,
    tempMaxC: tempMax,
    daylightHours: daylightSeconds / 3600,
  };
}

/**
 * Pulls every usable match out of an Open-Meteo geocoding response.
 *
 * Returns a list rather than one result because city names are genuinely
 * ambiguous: Manchester is in England and in New Hampshire, and guessing wrong
 * puts the candidate's weather and, worse, their email times on the wrong
 * continent. The caller shows the list and the candidate picks.
 *
 * Individual malformed entries are dropped rather than failing the whole
 * lookup: one odd row from the provider should not cost the candidate the four
 * good ones next to it.
 */
export function parseGeocodeList(payload: unknown): GeocodeResult[] {
  const results = (payload as { results?: unknown[] })?.results;
  if (!Array.isArray(results)) return [];

  const parsed: GeocodeResult[] = [];
  for (const row of results) {
    const r = row as Record<string, unknown>;
    const name = r.name;
    const countryCode = r.country_code;
    const latitude = r.latitude;
    const longitude = r.longitude;
    const timeZone = r.timezone;

    if (
      typeof name !== "string" ||
      typeof countryCode !== "string" ||
      typeof latitude !== "number" ||
      typeof longitude !== "number" ||
      typeof timeZone !== "string"
    ) {
      continue;
    }

    parsed.push({
      city: name,
      countryCode,
      latitude,
      longitude,
      timeZone,
      admin1: typeof r.admin1 === "string" ? r.admin1 : null,
    });
  }
  return parsed;
}

/** The single best match, for callers that do not need to disambiguate. */
export function parseGeocode(payload: unknown): GeocodeResult | null {
  return parseGeocodeList(payload)[0] ?? null;
}

async function getJson(url: string): Promise<unknown | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    // Timeout, DNS, TLS, malformed body: all the same thing from here, which is
    // "no weather today".
    return null;
  }
}

/**
 * Turns a typed city name into coordinates, for the profile form.
 *
 * Returns null when nothing matches, which the form should surface as "we could
 * not find that place" rather than as a failure. Nothing downstream requires a
 * location, so a candidate who cannot be geocoded simply has no weather copy.
 */
export async function geocodeCity(query: string, count = 5): Promise<GeocodeResult[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  const url =
    `${GEOCODE_URL}?name=${encodeURIComponent(trimmed)}` +
    `&count=${count}&language=en&format=json`;
  const payload = await getJson(url);
  if (payload === null) return [];

  return parseGeocodeList(payload);
}

/**
 * One day's observation for one place, from the cache when possible.
 *
 * The cache is the point: the coach runs once per candidate per slot, and
 * without it a hundred candidates in London would mean three hundred identical
 * upstream calls a day. Returns null on anything at all going wrong.
 */
export async function observationFor(
  latitude: number,
  longitude: number,
  localDate: string
): Promise<Observation | null> {
  const gridKey = roundToGrid(latitude, longitude);

  try {
    const cached = await db.weatherReading.findUnique({
      where: { gridKey_localDate: { gridKey, localDate } },
    });
    if (cached) {
      return {
        weatherCode: cached.weatherCode,
        tempMaxC: cached.tempMaxC,
        daylightHours: cached.daylightHours,
      };
    }
  } catch {
    // A cache read failing is not a reason to skip the fetch.
  }

  const url =
    `${FORECAST_URL}?latitude=${latitude}&longitude=${longitude}` +
    `&daily=weather_code,temperature_2m_max,daylight_duration` +
    `&timezone=auto&start_date=${localDate}&end_date=${localDate}`;

  const payload = await getJson(url);
  if (payload === null) return null;

  let observation: Observation;
  try {
    observation = parseForecast(payload, localDate);
  } catch {
    return null;
  }

  try {
    // upsert rather than create: two slots on the same morning can race, and
    // the unique key would turn the loser into an unhandled rejection.
    await db.weatherReading.upsert({
      where: { gridKey_localDate: { gridKey, localDate } },
      create: { gridKey, localDate, ...observation },
      update: {},
    });
  } catch {
    // Caching is an optimisation. Failing to cache is not failing.
  }

  return observation;
}
