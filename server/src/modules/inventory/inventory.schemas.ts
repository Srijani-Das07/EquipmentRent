import { z } from 'zod';
import { UNIT_STATUSES } from './inventory.rules.js';

const MAX_PRICE_PAISE = 100_000_000; // Rs 10,00,000

const paise = (label: string) =>
  z
    .number({ invalid_type_error: `${label} must be a number` })
    .int(`${label} must be a whole number of paise`)
    .positive(`${label} must be greater than zero`)
    .max(MAX_PRICE_PAISE, `${label} is too large`);

const name = (label: string, max: number) =>
  z.string().trim().min(2, `${label} must be at least 2 characters`).max(max, `${label} must be at most ${max} characters`);

export const idParamSchema = z.object({ id: z.string().trim().min(1).max(40) });

// ---- categories --------------------------------------------------------------

export const createCategorySchema = z.object({
  name: name('Name', 60),
  description: z.string().trim().max(300).optional(),
});

export const updateCategorySchema = z
  .object({
    name: name('Name', 60).optional(),
    description: z.string().trim().max(300).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to update' });

// ---- equipment ---------------------------------------------------------------

export const createEquipmentSchema = z.object({
  name: name('Name', 120),
  categoryId: z.string().trim().min(1, 'Category is required').max(40),
  description: z.string().trim().max(2000).default(''),
  dailyRatePaise: paise('Daily rate'),
  itemValuePaise: paise('Item value'),
});

export const updateEquipmentSchema = z
  .object({
    name: name('Name', 120).optional(),
    categoryId: z.string().trim().min(1).max(40).optional(),
    description: z.string().trim().max(2000).optional(),
    dailyRatePaise: paise('Daily rate').optional(),
    itemValuePaise: paise('Item value').optional(),
    archived: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to update' });

export const equipmentListQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  categoryId: z.string().trim().min(1).max(40).optional(),
  /** only equipment that has at least one available unit. */
  availableOnly: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(12),
  /** Only used by the staff/admin listing. */
  archived: z.enum(['active', 'archived', 'all']).default('all'),
});

// ---- units -------------------------------------------------------------------

export const createUnitSchema = z.object({
  tag: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9-]{1,29}$/, 'Tag must be 2 to 30 characters: letters, numbers and hyphens'),
});

export const updateUnitSchema = z.object({
  status: z.enum(UNIT_STATUSES),
});

export type EquipmentListQuery = z.infer<typeof equipmentListQuerySchema>;
export type CreateEquipmentInput = z.infer<typeof createEquipmentSchema>;
export type UpdateEquipmentInput = z.infer<typeof updateEquipmentSchema>;
