import { test, expect } from "vitest";
import { parseForecast, parseGeocode, parseGeocodeList, roundToGrid } from "./FUNC-weather";

// A real Open-Meteo daily response, trimmed to the fields we ask for. Three
// days rather than one, so a parser that ignores the date and reads index 0
// cannot pass.
const THREE_DAY_RESPONSE = {
  latitude: 51.5,
  longitude: -0.12,
  daily: {
    time: ["2027-02-10", "2027-02-11", "2027-02-12"],
    weather_code: [3, 63, 71],
    temperature_2m_max: [9.4, 6.1, -1.2],
    daylight_duration: [34920, 35280, 35640],
  },
};

test("the observation is read from the row matching the requested date", () => {
  // The middle day, so reading index 0 or the last index both fail. This is the
  // whole reason the fixture has three days in it.
  const observation = parseForecast(THREE_DAY_RESPONSE, "2027-02-11");
  expect(observation.weatherCode).toBe(63);
  expect(observation.tempMaxC).toBe(6.1);
});

test("daylight is converted from seconds to hours", () => {
  // Open-Meteo reports seconds. An unconverted value would be 35280, which
  // every daylight comparison would read as a very long day indeed, so the
  // dark-early tag would never fire anywhere on Earth.
  const observation = parseForecast(THREE_DAY_RESPONSE, "2027-02-11");
  expect(observation.daylightHours).toBeCloseTo(9.8, 5);
});

test("each of the three days parses to its own distinct values", () => {
  const first = parseForecast(THREE_DAY_RESPONSE, "2027-02-10");
  const last = parseForecast(THREE_DAY_RESPONSE, "2027-02-12");
  expect(first.weatherCode).toBe(3);
  expect(last.weatherCode).toBe(71);
  expect(first.tempMaxC).toBe(9.4);
  expect(last.tempMaxC).toBe(-1.2);
});

test("a date the response does not cover throws rather than guessing", () => {
  // Guessing would cache a junk reading for the day, and the coach would
  // describe the wrong weather with total confidence.
  expect(() => parseForecast(THREE_DAY_RESPONSE, "2027-02-20")).toThrow(/does not cover/);
});

test.each([
  ["no daily block", { latitude: 51.5 }, /no daily block/],
  ["no time array", { daily: { weather_code: [3] } }, /no daily\.time array/],
])("a malformed response throws: %s", (_label, payload, pattern) => {
  expect(() => parseForecast(payload, "2027-02-11")).toThrow(pattern);
});

test.each(["weather_code", "temperature_2m_max", "daylight_duration"])(
  "a response missing %s throws rather than returning a partial observation",
  (field) => {
    const broken = {
      daily: { ...THREE_DAY_RESPONSE.daily, [field]: [null, null, null] },
    };
    expect(() => parseForecast(broken, "2027-02-11")).toThrow(/missing a field/);
  }
);

test("a temperature of zero is a real reading, not a missing field", () => {
  // The bug this catches: a truthiness check instead of a typeof check would
  // treat 0 degrees as absent, so the parser would throw on every freezing day
  // in the calendar, which is exactly when the cold tag matters most.
  const freezing = {
    daily: { ...THREE_DAY_RESPONSE.daily, temperature_2m_max: [0, 0, 0], weather_code: [0, 0, 0] },
  };
  const observation = parseForecast(freezing, "2027-02-11");
  expect(observation.tempMaxC).toBe(0);
  expect(observation.weatherCode).toBe(0);
});

// GEOCODING

const MANCHESTERS = {
  results: [
    {
      name: "Manchester",
      country_code: "GB",
      latitude: 53.48,
      longitude: -2.24,
      timezone: "Europe/London",
      admin1: "England",
    },
    {
      name: "Manchester",
      country_code: "US",
      latitude: 42.99,
      longitude: -71.46,
      timezone: "America/New_York",
      admin1: "New Hampshire",
    },
  ],
};

test("the first geocoding match is returned with every field", () => {
  expect(parseGeocode(MANCHESTERS)).toEqual({
    city: "Manchester",
    countryCode: "GB",
    latitude: 53.48,
    longitude: -2.24,
    timeZone: "Europe/London",
    admin1: "England",
  });
});

test("every match is returned so the candidate can disambiguate", () => {
  // The reason this returns a list at all: picking the first Manchester for
  // someone in New Hampshire puts their weather and their email times on the
  // wrong continent, and nothing downstream could detect it.
  const all = parseGeocodeList(MANCHESTERS);
  expect(all).toHaveLength(2);
  expect(all.map((r) => r.countryCode)).toEqual(["GB", "US"]);
  expect(all.map((r) => r.timeZone)).toEqual(["Europe/London", "America/New_York"]);
});

test("a malformed entry is dropped without costing the good ones", () => {
  const mixed = {
    results: [
      { name: "Nowhere", country_code: "XX" },
      MANCHESTERS.results[1],
    ],
  };
  const all = parseGeocodeList(mixed);
  expect(all).toHaveLength(1);
  expect(all[0]!.countryCode).toBe("US");
});

test("a match with no timezone is unusable and is dropped", () => {
  // The zone is what sets the plan's email times. A result without one would
  // silently leave a candidate on UTC, which is the exact bug this field
  // exists to prevent, so it is required rather than defaulted.
  const noZone = {
    results: [{ name: "Somewhere", country_code: "GB", latitude: 1, longitude: 1 }],
  };
  expect(parseGeocodeList(noZone)).toEqual([]);
});

test("a missing admin1 is null rather than absent", () => {
  const noAdmin = {
    results: [
      { name: "Monaco", country_code: "MC", latitude: 43.73, longitude: 7.42, timezone: "Europe/Monaco" },
    ],
  };
  expect(parseGeocodeList(noAdmin)[0]!.admin1).toBeNull();
});

test.each([
  ["an empty result set", { results: [] }],
  ["no results key at all", {}],
  ["a result missing its coordinates", { results: [{ name: "Atlantis", country_code: "XX" }] }],
  ["a result with a string latitude", { results: [{ name: "A", country_code: "GB", latitude: "53.4", longitude: -2.2, timezone: "Europe/London" }] }],
])("geocoding returns null for %s", (_label, payload) => {
  // Null rather than a throw: a city we cannot find is an ordinary outcome the
  // profile form reports back, not a failure.
  expect(parseGeocode(payload)).toBeNull();
});

// GRID KEY

test("coordinates round to two decimals so one city shares one cache row", () => {
  // The point of the grid: these are three addresses in the same part of
  // London and they must all produce one key, or the cache never hits.
  expect(roundToGrid(51.5072, -0.1276)).toBe("51.51,-0.13");
  expect(roundToGrid(51.5074, -0.1281)).toBe("51.51,-0.13");
  expect(roundToGrid(51.5069, -0.1324)).toBe("51.51,-0.13");
});

test("places a few kilometres apart get different keys", () => {
  expect(roundToGrid(51.51, -0.13)).not.toBe(roundToGrid(53.48, -2.24));
});

test("the key is stable in sign and width for southern and western places", () => {
  // Would catch a key built by string concatenation without toFixed, where
  // -0.1 and -0.10 become different rows for the same place.
  expect(roundToGrid(-33.8688, 151.2093)).toBe("-33.87,151.21");
  expect(roundToGrid(-1.2, -36.8)).toBe("-1.20,-36.80");
});
