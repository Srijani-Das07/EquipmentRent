import { z } from 'zod';
import { CONDITIONS } from './returns.rules.js';

const bookingId = z.string().trim().min(1, 'Choose a booking').max(40);

export const processReturnSchema = z.object({
  bookingId,
  condition: z.enum(CONDITIONS),
  notes: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => (v ? v : undefined)),
});

export const returnPreviewQuerySchema = z.object({ bookingId, condition: z.enum(CONDITIONS) });

export type ProcessReturnInput = z.infer<typeof processReturnSchema>;
