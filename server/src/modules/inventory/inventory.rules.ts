/**
 * Pure business rules for the inventory module. Nothing in this file touches the
 * database or HTTP, so it can be unit tested on its own.
 */

export const UNIT_STATUSES = ['AVAILABLE', 'UNDER_MAINTENANCE', 'RETIRED'] as const;
export type UnitStatusName = (typeof UNIT_STATUSES)[number];

/**
 * Allowed manual status changes for a physical unit.
 * RETIRED is final. "Booked" is never stored; it is derived from bookings.
 */
export const ALLOWED_TRANSITIONS: Record<UnitStatusName, readonly UnitStatusName[]> = {
  AVAILABLE: ['UNDER_MAINTENANCE', 'RETIRED'],
  UNDER_MAINTENANCE: ['AVAILABLE', 'RETIRED'],
  RETIRED: [],
};

export function canTransition(from: UnitStatusName, to: UnitStatusName): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Turns a category name into a URL-safe slug, e.g. "Outdoor & Recreation" -> "outdoor-recreation". */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export interface UnitCounts {
  available: number;
  underMaintenance: number;
  retired: number;
  /** Units still in service (everything except retired). */
  total: number;
}

export function tallyUnits(units: ReadonlyArray<{ status: UnitStatusName }>): UnitCounts {
  const counts: UnitCounts = { available: 0, underMaintenance: 0, retired: 0, total: 0 };
  for (const u of units) {
    if (u.status === 'AVAILABLE') counts.available += 1;
    else if (u.status === 'UNDER_MAINTENANCE') counts.underMaintenance += 1;
    else counts.retired += 1;
  }
  counts.total = counts.available + counts.underMaintenance;
  return counts;
}
