import { z } from 'zod';
import { isValidDateOnly } from '../../lib/time.js';
import { BOOKING_STATUSES } from './booking.rules.js';

const dateOnly = z
  .string()
  .trim()
  .refine(isValidDateOnly, { message: 'Enter a valid date as YYYY-MM-DD' });

export const idParamSchema = z.object({ id: z.string().trim().min(1).max(40) });
export const equipmentIdParamSchema = z.object({ equipmentId: z.string().trim().min(1).max(40) });

/** Used for both the cost quote and the booking request. */
export const bookingRequestSchema = z.object({
  equipmentId: z.string().trim().min(1, 'Choose an equipment item').max(40),
  startDate: dateOnly,
  endDate: dateOnly,
});

export const modifyBookingSchema = z.object({ startDate: dateOnly, endDate: dateOnly });

export const bookingListQuerySchema = z.object({
  status: z.enum(BOOKING_STATUSES).optional(),
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export const availabilityQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Month must be YYYY-MM'),
});

export type BookingRequest = z.infer<typeof bookingRequestSchema>;
export type ModifyBookingInput = z.infer<typeof modifyBookingSchema>;
export type BookingListQuery = z.infer<typeof bookingListQuerySchema>;
