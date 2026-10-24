import { describe, it, expect } from 'vitest';
import { addDays, dateInZone, daysBetween, isValidDateOnly, zonedDateTimeToUtc } from '../src/lib/time.js';
import { makeReference } from '../src/lib/ids.js';
import {
  buildRentalWindow,
  calculateBookingCost,
  canTransition,
  dailyFreeCounts,
  findAlternativeWindows,
  freeUnitIds,
  isChangeable,
  overlaps,
  type BookedSpan,
} from '../src/modules/bookings/booking.rules.js';
import {
  computeCancellation,
  daysLate,
  isLateCancellation,
  lateCancellationFeePaise,
  lateFeePaise,
} from '../src/modules/payments/fees.js';

const settings = { pickupTime: '09:00', timezone: 'Asia/Kolkata' };
const now = new Date('2026-10-23T06:00:00Z');

describe('time helpers', () => {
  it('validates real calendar dates only', () => {
    expect(isValidDateOnly('2026-02-28')).toBe(true);
    expect(isValidDateOnly('2026-02-30')).toBe(false);
    expect(isValidDateOnly('26-02-01')).toBe(false);
  });

  it('adds days and counts the difference', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(daysBetween('2026-10-01', '2026-10-04')).toBe(3);
    expect(daysBetween('2026-10-04', '2026-10-01')).toBe(-3);
  });

  it('converts 09:00 in Asia/Kolkata to 03:30 UTC', () => {
    expect(zonedDateTimeToUtc('2026-11-03', '09:00', 'Asia/Kolkata').toISOString()).toBe('2026-11-03T03:30:00.000Z');
  });

  it('handles a daylight saving zone on both sides of the change', () => {
    // New York: UTC-4 before 1 Nov 2026, UTC-5 after.
    expect(zonedDateTimeToUtc('2026-10-31', '09:00', 'America/New_York').toISOString()).toBe('2026-10-31T13:00:00.000Z');
    expect(zonedDateTimeToUtc('2026-11-02', '09:00', 'America/New_York').toISOString()).toBe('2026-11-02T14:00:00.000Z');
  });

  it('reads the local date of an instant', () => {
    expect(dateInZone(new Date('2026-11-03T20:00:00Z'), 'Asia/Kolkata')).toBe('2026-11-04');
  });
});

describe('makeReference', () => {
  it('has the expected shape and varies', () => {
    const a = makeReference('BK', new Date('2026-10-23T00:00:00Z'));
    expect(a).toMatch(/^BK-20261023-[A-Z0-9]{5}$/);
    const set = new Set(Array.from({ length: 50 }, () => makeReference('BK', now)));
    expect(set.size).toBeGreaterThan(40);
  });
});

describe('status transitions', () => {
  it('allows the documented path only', () => {
    expect(canTransition('PENDING', 'CONFIRMED')).toBe(true);
    expect(canTransition('CONFIRMED', 'ACTIVE')).toBe(true);
    expect(canTransition('ACTIVE', 'COMPLETED')).toBe(true);
    expect(canTransition('PENDING', 'ACTIVE')).toBe(false);
    expect(canTransition('ACTIVE', 'CANCELLED')).toBe(false);
    expect(canTransition('COMPLETED', 'CANCELLED')).toBe(false);
  });

  it('only pending and confirmed bookings can be changed (U2)', () => {
    expect(isChangeable('PENDING')).toBe(true);
    expect(isChangeable('CONFIRMED')).toBe(true);
    expect(isChangeable('ACTIVE')).toBe(false);
    expect(isChangeable('COMPLETED')).toBe(false);
  });
});

describe('rental window and cost', () => {
  it('builds a window and counts days', () => {
    const w = buildRentalWindow('2026-11-03', '2026-11-06', settings, now);
    expect(w.days).toBe(3);
    expect(w.startAt.toISOString()).toBe('2026-11-03T03:30:00.000Z');
    expect(w.endAt.toISOString()).toBe('2026-11-06T03:30:00.000Z');
  });

  it('rejects bad ranges', () => {
    expect(() => buildRentalWindow('2026-11-03', '2026-11-03', settings, now)).toThrow();
    expect(() => buildRentalWindow('2026-11-06', '2026-11-03', settings, now)).toThrow();
    expect(() => buildRentalWindow('2026-11-03', '2026-12-10', settings, now)).toThrow(/at most/);
    expect(() => buildRentalWindow('2026-10-20', '2026-10-22', settings, now)).toThrow(/future/);
    expect(() => buildRentalWindow('2028-01-01', '2028-01-03', settings, now)).toThrow(/ahead/);
  });

  it('multiplies the rate by days', () => {
    expect(calculateBookingCost(250000, 3)).toBe(750000);
  });
});

describe('availability', () => {
  const t = (d: string) => zonedDateTimeToUtc(d, '09:00', settings.timezone);
  const spans: BookedSpan[] = [{ unitId: 'u1', startAt: t('2026-11-03'), endAt: t('2026-11-06') }];

  it('treats ranges as half open, so back to back bookings do not clash', () => {
    expect(overlaps(t('2026-11-03'), t('2026-11-06'), t('2026-11-06'), t('2026-11-08'))).toBe(false);
    expect(overlaps(t('2026-11-03'), t('2026-11-06'), t('2026-11-05'), t('2026-11-08'))).toBe(true);
  });

  it('finds units that are free, keeping order', () => {
    expect(freeUnitIds(['u1', 'u2'], spans, t('2026-11-04'), t('2026-11-05'))).toEqual(['u2']);
    expect(freeUnitIds(['u1'], spans, t('2026-11-04'), t('2026-11-05'))).toEqual([]);
    expect(freeUnitIds(['u1'], spans, t('2026-11-06'), t('2026-11-07'))).toEqual(['u1']);
  });

  it('suggests the next free windows of the same length (U1)', () => {
    const alts = findAlternativeWindows({
      unitIds: ['u1'],
      spans,
      startDate: '2026-11-03',
      days: 3,
      settings,
      now,
    });
    expect(alts[0]).toEqual({ startDate: '2026-11-06', endDate: '2026-11-09' });
    expect(alts).toHaveLength(3);
  });

  it('counts free units per day', () => {
    const days = dailyFreeCounts({
      unitIds: ['u1', 'u2'],
      spans,
      dates: ['2026-11-02', '2026-11-03', '2026-11-06'],
      settings,
    });
    expect(days.map((d) => d.free)).toEqual([2, 1, 2]);
  });
});

describe('cancellation and late fees', () => {
  const start = new Date('2026-11-03T03:30:00Z');

  it('is late only inside 24 hours of the start', () => {
    expect(isLateCancellation(start, new Date('2026-11-01T03:30:00Z'))).toBe(false);
    expect(isLateCancellation(start, new Date('2026-11-02T03:30:00Z'))).toBe(false); // exactly 24h
    expect(isLateCancellation(start, new Date('2026-11-02T03:30:01Z'))).toBe(true);
  });

  it('charges the percentage of the cost', () => {
    expect(lateCancellationFeePaise(100000, 20)).toBe(20000);
  });

  it('never charges for a pending booking', () => {
    const r = computeCancellation({ status: 'PENDING', costPaise: 100000, paidPaise: 0, startAt: start, now: new Date('2026-11-03T00:00:00Z'), lateCancellationFeePct: 20 });
    expect(r).toEqual({ free: true, feePaise: 0, refundPaise: 0 });
  });

  it('refunds everything for an early cancel of a paid booking', () => {
    const r = computeCancellation({ status: 'CONFIRMED', costPaise: 100000, paidPaise: 100000, startAt: start, now: new Date('2026-10-30T00:00:00Z'), lateCancellationFeePct: 20 });
    expect(r).toEqual({ free: true, feePaise: 0, refundPaise: 100000 });
  });

  it('keeps the fee and refunds the rest for a late cancel', () => {
    const r = computeCancellation({ status: 'CONFIRMED', costPaise: 100000, paidPaise: 100000, startAt: start, now: new Date('2026-11-03T00:00:00Z'), lateCancellationFeePct: 20 });
    expect(r).toEqual({ free: false, feePaise: 20000, refundPaise: 80000 });
  });

  it('caps the fee at what was paid', () => {
    const r = computeCancellation({ status: 'CONFIRMED', costPaise: 100000, paidPaise: 10000, startAt: start, now: new Date('2026-11-03T00:00:00Z'), lateCancellationFeePct: 50 });
    expect(r.feePaise).toBe(10000);
    expect(r.refundPaise).toBe(0);
  });

  it('computes return lateness in whole days, rounding up (F17)', () => {
    const due = new Date('2026-11-06T03:30:00Z');
    expect(daysLate(due, new Date('2026-11-06T03:00:00Z'))).toBe(0);
    expect(daysLate(due, new Date('2026-11-06T05:30:00Z'))).toBe(1);
    expect(daysLate(due, new Date('2026-11-08T03:30:00Z'))).toBe(2);
    expect(lateFeePaise(100, 2)).toBe(20000);
  });
});
