import { describe, it, expect } from 'vitest';
import { damagePenaltyPaise, damagePenaltyPct, unitOutcome } from '../src/modules/returns/returns.rules.js';
import { processReturnSchema } from '../src/modules/returns/returns.schemas.js';

const tiers = { minor: 15, major: 50, lost: 100 as const };

describe('damage penalty (F20, F27)', () => {
  it('uses the configured tier for each condition', () => {
    expect(damagePenaltyPct('GOOD', tiers)).toBe(0);
    expect(damagePenaltyPct('MINOR_DAMAGE', tiers)).toBe(15);
    expect(damagePenaltyPct('MAJOR_DAMAGE', tiers)).toBe(50);
    expect(damagePenaltyPct('LOST', tiers)).toBe(100);
  });

  it('is a percentage of the item value in paise', () => {
    expect(damagePenaltyPaise('GOOD', 5_000_000, tiers)).toBe(0);
    expect(damagePenaltyPaise('MINOR_DAMAGE', 5_000_000, tiers)).toBe(750_000);
    expect(damagePenaltyPaise('MAJOR_DAMAGE', 5_000_000, tiers)).toBe(2_500_000);
    expect(damagePenaltyPaise('LOST', 5_000_000, tiers)).toBe(5_000_000);
  });
});

describe('unit outcome after a return (F21, F23)', () => {
  it('retires a lost unit', () => {
    expect(unitOutcome({ condition: 'LOST', rentalsSinceMaintenance: 1, intervalRentals: 10 })).toEqual({
      status: 'RETIRED',
      maintenanceDue: false,
      trigger: null,
    });
  });

  it('sends damaged units to maintenance', () => {
    for (const condition of ['MINOR_DAMAGE', 'MAJOR_DAMAGE'] as const) {
      expect(unitOutcome({ condition, rentalsSinceMaintenance: 1, intervalRentals: 10 })).toEqual({
        status: 'UNDER_MAINTENANCE',
        maintenanceDue: true,
        trigger: 'DAMAGE',
      });
    }
  });

  it('keeps a good unit available until the interval is reached', () => {
    expect(unitOutcome({ condition: 'GOOD', rentalsSinceMaintenance: 9, intervalRentals: 10 }).status).toBe('AVAILABLE');
    expect(unitOutcome({ condition: 'GOOD', rentalsSinceMaintenance: 10, intervalRentals: 10 })).toEqual({
      status: 'UNDER_MAINTENANCE',
      maintenanceDue: true,
      trigger: 'PERIODIC',
    });
  });
});

describe('processReturnSchema', () => {
  it('accepts a condition and trims notes', () => {
    const r = processReturnSchema.parse({ bookingId: 'abc', condition: 'GOOD', notes: '  ok  ' });
    expect(r).toEqual({ bookingId: 'abc', condition: 'GOOD', notes: 'ok' });
  });

  it('rejects an unknown condition', () => {
    expect(processReturnSchema.safeParse({ bookingId: 'abc', condition: 'BROKEN' }).success).toBe(false);
  });
});
