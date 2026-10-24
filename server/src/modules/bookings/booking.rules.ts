/**
 * Pure booking rules: statuses, rental windows, availability maths. Nothing here touches
 * the database, so it is fully unit tested.
 */
import { AppError } from '../../lib/errors.js';
import { addDays, daysBetween, zonedDateTimeToUtc } from '../../lib/time.js';

// ---- status workflow (F12) --------------------------------------------------

export const BOOKING_STATUSES = ['PENDING', 'CONFIRMED', 'ACTIVE', 'COMPLETED', 'CANCELLED'] as const;
export type BookingStatusName = (typeof BOOKING_STATUSES)[number];

/** Pending -> Confirmed -> Active -> Completed, with Cancelled possible before handover. */
export const ALLOWED_TRANSITIONS: Record<BookingStatusName, readonly BookingStatusName[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['ACTIVE', 'CANCELLED'],
  ACTIVE: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
};

export const canTransition = (from: BookingStatusName, to: BookingStatusName): boolean =>
  ALLOWED_TRANSITIONS[from].includes(to);

/** Only bookings that have not started can be cancelled or modified (U2). */
export const isChangeable = (status: BookingStatusName): status is 'PENDING' | 'CONFIRMED' =>
  status === 'PENDING' || status === 'CONFIRMED';

// ---- cost (F15) ---------------------------------------------------------------

export const MAX_RENTAL_DAYS = 30;
export const MAX_ADVANCE_DAYS = 365;

/** F15: daily rate multiplied by the number of days, in paise. */
export const calculateBookingCost = (dailyRatePaise: number, days: number): number => dailyRatePaise * days;

// ---- rental window (F10) ------------------------------------------------------

export interface RentalWindow {
  startAt: Date;
  endAt: Date;
  days: number;
}

export interface WindowSettings {
  pickupTime: string; // "HH:mm"
  timezone: string; // IANA name
}

/**
 * Turns a pickup date and a return date into exact instants. A rental runs from the pickup
 * time on the first date to the same time on the return date; days is the date difference.
 */
export function buildRentalWindow(
  startDate: string,
  endDate: string,
  settings: WindowSettings,
  now: Date,
): RentalWindow {
  const days = daysBetween(startDate, endDate);
  if (days < 1) throw AppError.badRequest('The return date must be after the pickup date');
  if (days > MAX_RENTAL_DAYS) throw AppError.badRequest(`A rental can be at most ${MAX_RENTAL_DAYS} days`);

  const startAt = zonedDateTimeToUtc(startDate, settings.pickupTime, settings.timezone);
  const endAt = zonedDateTimeToUtc(endDate, settings.pickupTime, settings.timezone);
  if (startAt.getTime() <= now.getTime()) throw AppError.badRequest('The pickup time must be in the future');
  if (startAt.getTime() > now.getTime() + MAX_ADVANCE_DAYS * 86_400_000) {
    throw AppError.badRequest(`Bookings can be made at most ${MAX_ADVANCE_DAYS} days ahead`);
  }
  return { startAt, endAt, days };
}

// ---- availability (F11) -------------------------------------------------------

export interface BookedSpan {
  unitId: string;
  startAt: Date;
  endAt: Date;
}

/** Two half-open time ranges overlap when each starts before the other ends. */
export const overlaps = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean =>
  aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();

/** Units (in the given order) that have no booked span overlapping the requested range. */
export function freeUnitIds(unitIds: string[], spans: BookedSpan[], startAt: Date, endAt: Date): string[] {
  const busy = new Set(spans.filter((s) => overlaps(s.startAt, s.endAt, startAt, endAt)).map((s) => s.unitId));
  return unitIds.filter((id) => !busy.has(id));
}

export interface AlternativeWindow {
  startDate: string;
  endDate: string;
}

/**
 * U1 alternative flow: the next few date ranges of the same length in which at least one
 * unit is free, looking forward from the requested pickup date.
 */
export function findAlternativeWindows(input: {
  unitIds: string[];
  spans: BookedSpan[];
  startDate: string;
  days: number;
  settings: WindowSettings;
  now: Date;
  count?: number;
  horizonDays?: number;
}): AlternativeWindow[] {
  const { unitIds, spans, startDate, days, settings, now } = input;
  const wanted = input.count ?? 3;
  const horizon = input.horizonDays ?? 60;
  const found: AlternativeWindow[] = [];

  for (let offset = 1; offset <= horizon && found.length < wanted; offset++) {
    const candidateStart = addDays(startDate, offset);
    const candidateEnd = addDays(candidateStart, days);
    const startAt = zonedDateTimeToUtc(candidateStart, settings.pickupTime, settings.timezone);
    const endAt = zonedDateTimeToUtc(candidateEnd, settings.pickupTime, settings.timezone);
    if (startAt.getTime() <= now.getTime()) continue;
    if (freeUnitIds(unitIds, spans, startAt, endAt).length > 0) {
      found.push({ startDate: candidateStart, endDate: candidateEnd });
    }
  }
  return found;
}

/** Number of free units for each calendar day of a month (used by the availability calendar). */
export function dailyFreeCounts(input: {
  unitIds: string[];
  spans: BookedSpan[];
  dates: string[];
  settings: WindowSettings;
}): Array<{ date: string; free: number }> {
  return input.dates.map((date) => {
    const startAt = zonedDateTimeToUtc(date, input.settings.pickupTime, input.settings.timezone);
    const endAt = zonedDateTimeToUtc(addDays(date, 1), input.settings.pickupTime, input.settings.timezone);
    return { date, free: freeUnitIds(input.unitIds, input.spans, startAt, endAt).length };
  });
}
