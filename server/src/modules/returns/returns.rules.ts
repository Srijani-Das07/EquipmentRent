/**
 * Pure rules for returns. Nothing here touches the database or HTTP.
 */
import { percentOf } from '../../lib/money.js';

export const CONDITIONS = ['GOOD', 'MINOR_DAMAGE', 'MAJOR_DAMAGE', 'LOST'] as const;
export type ConditionName = (typeof CONDITIONS)[number];

export const conditionLabel: Record<ConditionName, string> = {
  GOOD: 'Good',
  MINOR_DAMAGE: 'Minor damage',
  MAJOR_DAMAGE: 'Major damage',
  LOST: 'Lost',
};

export interface PenaltyTiers {
  minor: number;
  major: number;
  lost: 100;
}

/** F27: Good = 0%, Minor and Major from the policy file, Lost = 100% of item value. */
export function damagePenaltyPct(condition: ConditionName, tiers: PenaltyTiers): number {
  switch (condition) {
    case 'GOOD':
      return 0;
    case 'MINOR_DAMAGE':
      return tiers.minor;
    case 'MAJOR_DAMAGE':
      return tiers.major;
    case 'LOST':
      return 100;
  }
}

/** F20: the penalty is a percentage of the item's value. */
export const damagePenaltyPaise = (condition: ConditionName, itemValuePaise: number, tiers: PenaltyTiers): number =>
  percentOf(itemValuePaise, damagePenaltyPct(condition, tiers));

export interface UnitOutcome {
  status: 'AVAILABLE' | 'UNDER_MAINTENANCE' | 'RETIRED';
  maintenanceDue: boolean;
  trigger: 'DAMAGE' | 'PERIODIC' | null;
}

/**
 * What happens to the physical unit after a return (F21, F23).
 * Lost units are retired. Damaged units go to maintenance. Otherwise the unit goes to
 * maintenance only when its rental count since the last maintenance reaches the interval.
 */
export function unitOutcome(input: {
  condition: ConditionName;
  rentalsSinceMaintenance: number; // already includes this rental
  intervalRentals: number;
}): UnitOutcome {
  if (input.condition === 'LOST') return { status: 'RETIRED', maintenanceDue: false, trigger: null };
  if (input.condition === 'MINOR_DAMAGE' || input.condition === 'MAJOR_DAMAGE') {
    return { status: 'UNDER_MAINTENANCE', maintenanceDue: true, trigger: 'DAMAGE' };
  }
  if (input.rentalsSinceMaintenance >= input.intervalRentals) {
    return { status: 'UNDER_MAINTENANCE', maintenanceDue: true, trigger: 'PERIODIC' };
  }
  return { status: 'AVAILABLE', maintenanceDue: false, trigger: null };
}
