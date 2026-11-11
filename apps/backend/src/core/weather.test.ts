import { test, expect } from "vitest";
import { weatherTags, type Observation } from "./weather";

function obs(overrides: Partial<Observation> = {}): Observation {
  // A dull, mild, ordinary day: every tag off by default, so any tag that
  // appears in a test was put there by the field that test changed.
  return { weatherCode: 3, tempMaxC: 12, daylightHours: 12, ...overrides };
}

test("an ordinary overcast mild day earns no tags at all", () => {
  // The common case. If this ever returns a tag, every weather line in the file
  // starts appearing on days that do not deserve them.
  expect(weatherTags(obs())).toEqual([]);
});

// CONDITION MAPPING, checked against the published WMO table rather than
// against whatever the implementation happens to group together.

test.each([
  [95, "storm"],
  [96, "storm"],
  [99, "storm"],
  [71, "snow"],
  [75, "snow"],
  [77, "snow"],
  [85, "snow"],
  [86, "snow"],
  [51, "rain"],
  [55, "rain"],
  [61, "rain"],
  [65, "rain"],
  [80, "rain"],
  [82, "rain"],
])("WMO code %i maps to %s", (code, tag) => {
  expect(weatherTags(obs({ weatherCode: code }))).toContain(tag);
});

test.each([56, 57, 66, 67])(
  "freezing precipitation code %i counts as snow, not rain",
  (code) => {
    // Grouped with snow deliberately: for someone deciding whether to leave the
    // house, freezing rain behaves like snow. If this ever flips to rain the
    // copy will describe a sheet of ice as a shower.
    const tags = weatherTags(obs({ weatherCode: code }));
    expect(tags).toContain("snow");
    expect(tags).not.toContain("rain");
  }
);

test.each([0, 1, 2, 3, 45, 48])("code %i is not precipitation", (code) => {
  const tags = weatherTags(obs({ weatherCode: code }));
  expect(tags).not.toContain("rain");
  expect(tags).not.toContain("snow");
  expect(tags).not.toContain("storm");
});

test("a thunderstorm is reported as a storm and not downgraded to rain", () => {
  // Precedence, not just membership: 95 is precipitation too, and an
  // implementation that checked rain first would call a thunderstorm a shower.
  const tags = weatherTags(obs({ weatherCode: 95 }));
  expect(tags).toContain("storm");
  expect(tags).not.toContain("rain");
});

// TEMPERATURE BOUNDARIES. An off-by-one on a threshold is the likely bug here
// and sampling the middle of a band cannot see it.

test.each([
  [29.9, false],
  [30, true],
  [30.1, true],
])("tempMax %f gives heat: %s", (temp, expected) => {
  expect(weatherTags(obs({ tempMaxC: temp })).includes("heat")).toBe(expected);
});

test.each([
  [2.9, true],
  [3, true],
  [3.1, false],
])("tempMax %f gives cold: %s", (temp, expected) => {
  expect(weatherTags(obs({ tempMaxC: temp })).includes("cold")).toBe(expected);
});

test("heat and cold are mutually exclusive at every temperature", () => {
  for (let t = -20; t <= 45; t += 0.5) {
    const tags = weatherTags(obs({ tempMaxC: t }));
    expect(tags.includes("heat") && tags.includes("cold")).toBe(false);
  }
});

// CLEAR-WARM needs BOTH halves, because that specific pairing is what empties a
// desk. A warm overcast day pulls nobody outdoors and must not be tagged.

test("clear-warm needs a clear sky as well as the warmth", () => {
  expect(weatherTags(obs({ weatherCode: 0, tempMaxC: 24 }))).toContain("clear-warm");
  expect(weatherTags(obs({ weatherCode: 1, tempMaxC: 24 }))).toContain("clear-warm");
  // Overcast at the same temperature: warm, but nobody is going to the park.
  expect(weatherTags(obs({ weatherCode: 3, tempMaxC: 24 }))).not.toContain("clear-warm");
  // Clear but cold: a bright February day is not a distraction.
  expect(weatherTags(obs({ weatherCode: 0, tempMaxC: 8 }))).not.toContain("clear-warm");
});

test.each([
  [19.9, false],
  [20, true],
])("a clear sky at %f gives clear-warm: %s", (temp, expected) => {
  expect(weatherTags(obs({ weatherCode: 0, tempMaxC: temp })).includes("clear-warm")).toBe(
    expected
  );
});

// DAYLIGHT is independent of conditions and of temperature.

test.each([
  [9.4, true],
  [9.5, false],
  [16, false],
])("daylight of %f hours gives dark-early: %s", (hours, expected) => {
  expect(weatherTags(obs({ daylightHours: hours })).includes("dark-early")).toBe(expected);
});

test("a dark day is tagged dark-early whatever the sky is doing", () => {
  // Would catch an implementation that nested the daylight check inside a
  // conditions branch, which would silently lose the tag on clear winter days.
  for (const code of [0, 3, 63, 75, 95]) {
    expect(weatherTags(obs({ weatherCode: code, daylightHours: 7 }))).toContain("dark-early");
  }
});

test("a cold dark day with sleet earns all three of its tags", () => {
  // Tags are not exclusive. A January day in Helsinki is genuinely snow, cold
  // and dark-early, and the picker needs all three to find the best line.
  const tags = weatherTags({ weatherCode: 73, tempMaxC: -4, daylightHours: 6 });
  expect(tags).toContain("snow");
  expect(tags).toContain("cold");
  expect(tags).toContain("dark-early");
});

test("an unknown WMO code degrades to no condition tag rather than throwing", () => {
  // Open-Meteo could add a code. The coach must still send the email.
  expect(() => weatherTags(obs({ weatherCode: 1234 }))).not.toThrow();
  const tags = weatherTags(obs({ weatherCode: 1234 }));
  expect(tags).not.toContain("rain");
  expect(tags).not.toContain("snow");
  expect(tags).not.toContain("storm");
});
