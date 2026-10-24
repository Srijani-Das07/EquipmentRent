import { percentOf, rupeesToPaise } from '../../lib/money.js';

const DAY_MS = 86_400_000;

/** F14, F18: cancelling or modifying less than 24 hours before the start is "late". */
export const LATE_CANCELLATION_HOURS = 24;

export const isLateCancellation = (startAt: Date, now: Date): boolean =>
  startAt.getTime() - now.getTime() < LATE_CANCELLATION_HOURS * 3_600_000;

/** F14, F18: fee is a percentage of the booking cost (percentage comes from the policy file). */
export const lateCancellationFeePaise = (costPaise: number, pct: number): number => percentOf(costPaise, pct);

/** F17: every started day after the due time counts as one late day. */
export function daysLate(dueAt: Date, returnedAt: Date): number {
  const late = returnedAt.getTime() - dueAt.getTime();
  return late > 0 ? Math.ceil(late / DAY_MS) : 0;
}

/** F17: late fee per day (rupees, from the policy file) times days late, in paise. */
export const lateFeePaise = (feePerDayRupees: number, lateDays: number): number =>
  rupeesToPaise(feePerDayRupees) * lateDays;

export interface CancellationOutcome {
  /** True when no fee applies. */
  free: boolean;
  feePaise: number;
  /** Amount returned to the customer. */
  refundPaise: number;
}

/**
 * F13, F14: works out the fee and refund for cancelling a booking.
 * An unpaid pending booking is always free. For a paid booking the fee is kept out of
 * the payment and the rest is refunded.
 */
export function computeCancellation(input: {
  status: 'PENDING' | 'CONFIRMED';
  costPaise: number;
  paidPaise: number;
  startAt: Date;
  now: Date;
  lateCancellationFeePct: number;
}): CancellationOutcome {
  if (input.status === 'PENDING') return { free: true, feePaise: 0, refundPaise: 0 };
  const late = isLateCancellation(input.startAt, input.now);
  const fee = late ? Math.min(lateCancellationFeePaise(input.costPaise, input.lateCancellationFeePct), input.paidPaise) : 0;
  return { free: !late || fee === 0, feePaise: fee, refundPaise: input.paidPaise - fee };
}
