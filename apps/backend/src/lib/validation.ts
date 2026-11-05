import { z } from "zod";

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
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
  examDate: z.coerce.date(),
  startDate: z.coerce.date().optional(),
  weeklyAvailability: weeklyAvailabilitySchema,
  initialLogs: z.array(initialLogSchema).optional(),
});

export const patchPlanSchema = z.object({
  examDate: z.coerce.date().optional(),
  weeklyAvailability: weeklyAvailabilitySchema.optional(),
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
  examDate: z.coerce.date(),
  startDate: z.coerce.date().optional(),
  weeklyAvailability: weeklyAvailabilitySchema,
  packages: z.array(planPackageSchema).optional(),
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
  })
  // The DB default (0) only applies when the column is omitted entirely; a
  // request's explicit value still needs this same-request cross-field check.
  .refine((data) => (data.questionsCorrect ?? 0) <= data.questionsAnswered, {
    message: "questionsCorrect cannot exceed questionsAnswered",
    path: ["questionsCorrect"],
  });
