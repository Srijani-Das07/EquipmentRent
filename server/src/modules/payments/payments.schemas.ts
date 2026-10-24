import { z } from 'zod';
import { luhnValid } from './gateway.js';

const cardNumber = z
  .string()
  .transform((s) => s.replace(/[\s-]/g, ''))
  .pipe(
    z
      .string()
      .regex(/^\d{12,19}$/, 'Card number must have 12 to 19 digits')
      .refine(luhnValid, 'Card number is not valid'),
  );

/** UPI is simulated: the client reports whether the fake payment succeeded. */
const upiPayment = z.object({
  method: z.literal('UPI'),
  outcome: z.enum(['SUCCESS', 'FAILURE']),
});

const cardPayment = z.object({
  method: z.literal('CARD'),
  cardNumber,
  expiry: z.string().trim().regex(/^(0[1-9]|1[0-2])\/\d{2}$/, 'Expiry must be MM/YY'),
  cvv: z.string().trim().regex(/^\d{3,4}$/, 'CVV must be 3 or 4 digits'),
  name: z.string().trim().min(2, 'Enter the name on the card').max(60),
});

export const payChargeSchema = z.discriminatedUnion('method', [upiPayment, cardPayment]);

export const chargeIdParamSchema = z.object({ id: z.string().trim().min(1).max(40) });

export const chargeListQuerySchema = z.object({
  status: z.enum(['PENDING', 'PAID', 'FAILED', 'VOID']).optional(),
});

export type PayChargeInput = z.infer<typeof payChargeSchema>;
