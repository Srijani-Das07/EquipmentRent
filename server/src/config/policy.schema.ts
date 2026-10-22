import { z } from 'zod';

/**
 * Schema for equipment_policy_config.json (SRS F29, S4).
 * Money values (late_fee_per_day) are in INR rupees here for admin-friendliness;
 * the app converts to integer paise when it calculates charges.
 * Every object is .strict(): unknown keys are rejected so typos and junk never slip in.
 */

const pct = z.number().min(0, 'must be >= 0').max(100, 'must be <= 100');
const fee = z.number().min(0, 'must be >= 0').max(1_000_000, 'is unreasonably large');
const interval = z.number().int('must be a whole number').min(1, 'must be >= 1').max(10_000);

export const damagePenaltyDefaultsSchema = z
  .object({
    minor: pct,
    major: pct,
    // F27: a lost item is always charged 100% of its value. Not configurable.
    lost: z.literal(100),
  })
  .strict()
  .refine((v) => v.minor <= v.major, { message: 'minor must not exceed major' });

export const policyDefaultsSchema = z
  .object({
    maintenance_interval_rentals: interval,
    damage_penalty_pct: damagePenaltyDefaultsSchema,
    late_fee_per_day: fee,
    late_cancellation_fee_pct: pct,
  })
  .strict();

// Overrides are partial; "lost" cannot be overridden.
export const policyOverrideSchema = z
  .object({
    maintenance_interval_rentals: interval.optional(),
    damage_penalty_pct: z
      .object({ minor: pct.optional(), major: pct.optional() })
      .strict()
      .optional(),
    late_fee_per_day: fee.optional(),
    late_cancellation_fee_pct: pct.optional(),
  })
  .strict();

export const systemSettingsSchema = z
  .object({
    data_retention_days: z.number().int().min(30, 'must be at least 30 days').max(36_500),
    payment_hold_minutes: z.number().int().min(1).max(240),
    pickup_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:mm (24-hour)'),
    timezone: z.string().min(1).refine(isValidTimezone, { message: 'is not a valid IANA timezone' }),
  })
  .strict();

const overrideKey = z.string().min(1).max(100);

export const policyConfigSchema = z
  .object({
    schema_version: z.literal(1),
    defaults: policyDefaultsSchema,
    system: systemSettingsSchema,
    overrides: z
      .object({
        categories: z.record(overrideKey, policyOverrideSchema),
        equipment: z.record(overrideKey, policyOverrideSchema),
      })
      .strict(),
  })
  .strict()
  .superRefine((cfg, ctx) => {
    // A merged minor/major pair must still make sense for every override.
    const check = (scope: 'categories' | 'equipment', key: string, o: PolicyOverride) => {
      const minor = o.damage_penalty_pct?.minor ?? cfg.defaults.damage_penalty_pct.minor;
      const major = o.damage_penalty_pct?.major ?? cfg.defaults.damage_penalty_pct.major;
      if (minor > major) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['overrides', scope, key, 'damage_penalty_pct'],
          message: `minor (${minor}) must not exceed major (${major}) after applying defaults`,
        });
      }
    };
    for (const [k, v] of Object.entries(cfg.overrides.categories)) check('categories', k, v);
    for (const [k, v] of Object.entries(cfg.overrides.equipment)) check('equipment', k, v);
  });

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export type PolicyConfig = z.infer<typeof policyConfigSchema>;
export type PolicyOverride = z.infer<typeof policyOverrideSchema>;
export type SystemSettings = z.infer<typeof systemSettingsSchema>;

/** The fully resolved rules for one equipment item (override > category > default). */
export interface ResolvedPolicy {
  maintenanceIntervalRentals: number;
  damagePenaltyPct: { minor: number; major: number; lost: 100 };
  lateFeePerDay: number; // INR rupees
  lateCancellationFeePct: number;
}
