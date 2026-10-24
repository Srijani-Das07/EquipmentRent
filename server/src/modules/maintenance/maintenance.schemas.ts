import { z } from 'zod';

export const unitIdParamSchema = z.object({ unitId: z.string().trim().min(1).max(40) });

export const queueQuerySchema = z.object({ view: z.enum(['open', 'cleared']).default('open') });

export const clearMaintenanceSchema = z.object({
  notes: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => (v ? v : undefined)),
});

export type QueueQuery = z.infer<typeof queueQuerySchema>;
