import { z } from "zod";
import { TUNING_RANGES } from "../core/tuning";

// A crafted far-future examDate would make pace.ts's remaining-hours math
// (and anything iterating the plan's day span) churn for an unbounded span;
// 10 years comfortably covers any real CFA candidate's plan while keeping
// every date-span computation bounded. Computed per-parse (not a fixed Date
// captured at module load) so the ceiling stays 10 years from "now", not
// 10 years from server-start.
const TEN_YEARS_MS = 10 * 365 * 24 * 60 * 60 * 1000;
const examDateSchema = z.coerce.date().refine((d) => d.getTime() <= Date.now() + TEN_YEARS_MS, {
  message: "examDate must not be more than 10 years in the future",
});

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

// newPassword uses the same min(8) rule as registerSchema's password - "the
// same validation as registration" per the change-password route's brief.
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

export const weeklyAvailabilitySchema = z.object({
  mon: z.number().min(0),
  tue: z.number().min(0),
  wed: z.number().min(0),
  thu: z.number().min(0),
  fri: z.number().min(0),
  sat: z.number().min(0),
  sun: z.number().min(0),
});

const initialLogSchema = z.object({
  losId: z.string(),
  confidence: z.number().int().min(1).max(5),
  questionsAnswered: z.number().int().min(0),
});

export const createPlanSchema = z.object({
  levelId: z.string(),
  examDate: examDateSchema,
  startDate: z.coerce.date().optional(),
  weeklyAvailability: weeklyAvailabilitySchema,
  initialLogs: z.array(initialLogSchema).optional(),
});

/**
 * An IANA zone name, validated by asking the platform rather than by matching a
 * pattern. A regex that accepts anything shaped like "Area/City" would let
 * "Europe/Narnia" through, and the failure then surfaces as every email going
 * out at the wrong hour rather than as a rejected request.
 */
const timeZoneSchema = z.string().refine(
  (tz) => {
    try {
      new Intl.DateTimeFormat("en-GB", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  },
  { message: "timeZone must be a valid IANA zone name" }
);

/**
 * Where the candidate says they are, used only to colour the coach's copy with
 * local weather and daylight.
 *
 * All four fields move together: coordinates without a city name would give the
 * copy nothing to say, and a city name without coordinates could not be looked
 * up. Passing null clears the location entirely, which is how a candidate
 * withdraws it.
 *
 * Coordinates come from the client because the candidate picks their city from
 * a geocoded list, so the ranges are checked here. A valid but wrong coordinate
 * only affects that candidate's own weather lines, which is why this needs
 * range validation rather than a trust boundary.
 */
const locationSchema = z.object({
  city: z.string().min(1).max(120),
  countryCode: z.string().length(2),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  timeZone: timeZoneSchema,
});

// Built from the engine's own range table rather than retyped, so a constant
// added to core/tuning.ts cannot be forgotten here and silently rejected as an
// unknown key. strict() is what turns a typo in a client into a 400 instead of
// a setting that appears to save and never applies.
export const tuningSchema = z
  .object(
    Object.fromEntries(
      Object.keys(TUNING_RANGES).map((field) => [field, z.number().finite().optional()]),
    ) as Record<keyof typeof TUNING_RANGES, z.ZodOptional<z.ZodNumber>>,
  )
  .strict();

export const patchPlanSchema = z.object({
  examDate: examDateSchema.optional(),
  weeklyAvailability: weeklyAvailabilitySchema.optional(),
  timeZone: timeZoneSchema.optional(),
  // Closed sets, matching the StudyPlan column comments. One per channel,
  // because wanting the full written briefing in your inbox and only the
  // evening prod on your phone is a normal preference that a single setting
  // could not express.
  emailCoach: z.enum(["all", "debrief-only", "off"]).optional(),
  pushCoach: z.enum(["all", "debrief-only", "off"]).optional(),
  // null clears it; omitted leaves it untouched.
  location: locationSchema.nullable().optional(),
  // Which sequence the first pass follows, and when the review phase starts.
  // Closed sets, matching core/tuning.ts, which is the only thing that reads
  // them. An unrecognised value is a 400 rather than a silent fallback: a
  // candidate who picked a mode from a list is entitled to get that mode or an
  // error, never a different one.
  planMode: z.enum(["effort-return", "curriculum-strict", "curriculum-topic"]).optional(),
  reviewPolicy: z
    .enum(["decay-triggered", "after-coverage", "weekly-interleave", "fixed-date"])
    .optional(),
  // null clears it. Only read under the fixed-date policy.
  reviewStartDate: z.coerce.date().nullable().optional(),
  // The planner constants. Shape is checked here, RANGE is not: a number
  // outside its range is accepted, clamped by parseTuning and reported back,
  // so one bad field in a settings form does not cost the candidate the good
  // fields they changed in the same request. A key the engine does not read,
  // or a value that is not a number, IS a 400, because both mean the client
  // and the server disagree about what exists.
  tuning: tuningSchema.optional(),
});

export const createHolidaySchema = z.object({
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  note: z.string().optional(),
});

export const planPackageSchema = z.object({
  packageId: z.string(),
  roles: z.array(z.enum(["content", "questions", "mocks"])).min(1),
});

export const createPackageSchema = z.object({
  name: z.string().min(1),
});

// Same shape as createPlanSchema, minus initialLogs (an export/import file
// carries plan-level packages, not raw log history) and plus an optional
// packages list - the plan's PlanPackage tags, same shape as
// planPackageSchema, so a plan can round-trip its package roles on import.
export const importPlanSchema = z.object({
  levelId: z.string(),
  examDate: examDateSchema,
  startDate: z.coerce.date().optional(),
  weeklyAvailability: weeklyAvailabilitySchema,
  packages: z.array(planPackageSchema).optional(),
});

export const createMockExamSchema = z.object({
  planId: z.string(),
  date: z.coerce.date(),
  scorePercent: z.number().int().min(0).max(100),
  packageId: z.string().optional(),
  note: z.string().optional(),
});

export const subscribePushSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

export const unsubscribePushSchema = z.object({
  endpoint: z.string().url(),
});

export const createLogSchema = z
  .object({
    planId: z.string(),
    losId: z.string(),
    confidence: z.number().int().min(1).max(5),
    questionsAnswered: z.number().int().min(0),
    questionsCorrect: z.number().int().min(0).optional(),
    packageId: z.string().optional(),
    note: z.string().optional(),
    // Optional: lets a candidate log yesterday's session instead of only
    // "now". Absent means "today", same as before this field existed. The
    // route checks this against the plan's startDate/today (needs the DB
    // row), not here.
    date: z.coerce.date().optional(),
  })
  // The DB default (0) only applies when the column is omitted entirely; a
  // request's explicit value still needs this same-request cross-field check.
  .refine((data) => (data.questionsCorrect ?? 0) <= data.questionsAnswered, {
    message: "questionsCorrect cannot exceed questionsAnswered",
    path: ["questionsCorrect"],
  });

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

// The minimum matches registerSchema: a reset must not be a way to set a
// weaker password than signing up would allow.
export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8),
});
