import { describe, it, expect } from 'vitest';
import {
  createCategorySchema,
  createEquipmentSchema,
  createUnitSchema,
  equipmentListQuerySchema,
  updateCategorySchema,
  updateEquipmentSchema,
  updateUnitSchema,
} from '../src/modules/inventory/inventory.schemas.js';
import { canTransition, slugify, tallyUnits, type UnitStatusName } from '../src/modules/inventory/inventory.rules.js';

const validEquipment = {
  name: 'Cordless Drill',
  categoryId: 'cat_1',
  description: 'Two batteries included',
  dailyRatePaise: 40000,
  itemValuePaise: 900000,
};

describe('createEquipmentSchema', () => {
  it('accepts valid input and trims text', () => {
    const out = createEquipmentSchema.parse({ ...validEquipment, name: '  Cordless Drill  ' });
    expect(out.name).toBe('Cordless Drill');
    expect(out.dailyRatePaise).toBe(40000);
  });

  it('defaults the description to an empty string', () => {
    const { description: _omit, ...rest } = validEquipment;
    expect(createEquipmentSchema.parse(rest).description).toBe('');
  });

  it.each([
    ['name too short', { name: 'A' }],
    ['missing category', { categoryId: '' }],
    ['zero rate', { dailyRatePaise: 0 }],
    ['negative rate', { dailyRatePaise: -100 }],
    ['fractional rate', { dailyRatePaise: 100.5 }],
    ['rate as text', { dailyRatePaise: '400' }],
    ['value too large', { itemValuePaise: 999_999_999 }],
  ])('rejects %s', (_label, patch) => {
    expect(createEquipmentSchema.safeParse({ ...validEquipment, ...patch }).success).toBe(false);
  });
});

describe('updateEquipmentSchema', () => {
  it('rejects an empty update', () => {
    expect(updateEquipmentSchema.safeParse({}).success).toBe(false);
  });
  it('accepts a single field and the archived flag', () => {
    expect(updateEquipmentSchema.safeParse({ dailyRatePaise: 50000 }).success).toBe(true);
    expect(updateEquipmentSchema.safeParse({ archived: true }).success).toBe(true);
  });
  it('still validates the fields that are sent', () => {
    expect(updateEquipmentSchema.safeParse({ dailyRatePaise: -5 }).success).toBe(false);
  });
});

describe('category schemas', () => {
  it('accepts a valid category and rejects a short name', () => {
    expect(createCategorySchema.safeParse({ name: 'Tools' }).success).toBe(true);
    expect(createCategorySchema.safeParse({ name: 'T' }).success).toBe(false);
  });
  it('rejects an empty category update', () => {
    expect(updateCategorySchema.safeParse({}).success).toBe(false);
  });
});

describe('createUnitSchema', () => {
  it('upper-cases and trims the tag', () => {
    expect(createUnitSchema.parse({ tag: '  drl-007 ' }).tag).toBe('DRL-007');
  });
  it.each([['a'], ['has space'], ['bad_underscore'], ['-LEADING'], ['X'.repeat(31)]])('rejects tag %j', (tag) => {
    expect(createUnitSchema.safeParse({ tag }).success).toBe(false);
  });
});

describe('updateUnitSchema', () => {
  it('accepts the three stored statuses only', () => {
    for (const status of ['AVAILABLE', 'UNDER_MAINTENANCE', 'RETIRED']) {
      expect(updateUnitSchema.safeParse({ status }).success).toBe(true);
    }
    expect(updateUnitSchema.safeParse({ status: 'RENTED' }).success).toBe(false);
  });
});

describe('equipmentListQuerySchema', () => {
  it('applies defaults', () => {
    const q = equipmentListQuerySchema.parse({});
    expect(q).toMatchObject({ page: 1, pageSize: 12, archived: 'all' });
  });
  it('converts numeric strings from the query string', () => {
    expect(equipmentListQuerySchema.parse({ page: '3', pageSize: '20' })).toMatchObject({ page: 3, pageSize: 20 });
  });
  it.each([[{ page: '0' }], [{ pageSize: '500' }], [{ archived: 'maybe' }]])('rejects %j', (q) => {
    expect(equipmentListQuerySchema.safeParse(q).success).toBe(false);
  });
});

describe('unit status transitions', () => {
  it.each<[UnitStatusName, UnitStatusName, boolean]>([
    ['AVAILABLE', 'UNDER_MAINTENANCE', true],
    ['AVAILABLE', 'RETIRED', true],
    ['UNDER_MAINTENANCE', 'AVAILABLE', true],
    ['UNDER_MAINTENANCE', 'RETIRED', true],
    ['RETIRED', 'AVAILABLE', false],
    ['RETIRED', 'UNDER_MAINTENANCE', false],
    ['AVAILABLE', 'AVAILABLE', false],
  ])('%s to %s is allowed: %s', (from, to, expected) => {
    expect(canTransition(from, to)).toBe(expected);
  });
});

describe('slugify', () => {
  it.each([
    ['Outdoor & Recreation', 'outdoor-recreation'],
    ['  Events   Party ', 'events-party'],
    ['Tools', 'tools'],
    ['!!!', ''],
  ])('%j becomes %j', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });
});

describe('tallyUnits', () => {
  it('counts by status and excludes retired units from the total', () => {
    const counts = tallyUnits([
      { status: 'AVAILABLE' },
      { status: 'AVAILABLE' },
      { status: 'UNDER_MAINTENANCE' },
      { status: 'RETIRED' },
    ]);
    expect(counts).toEqual({ available: 2, underMaintenance: 1, retired: 1, total: 3 });
  });
});


describe('availableOnly filter (F8)', () => {
  it('defaults to false', () => {
    expect(equipmentListQuerySchema.parse({}).availableOnly).toBe(false);
  });
  it.each([
    ['true', true],
    ['false', false],
  ])('converts the query value %j to %s', (raw, expected) => {
    expect(equipmentListQuerySchema.parse({ availableOnly: raw }).availableOnly).toBe(expected);
  });
  it('rejects other values', () => {
    expect(equipmentListQuerySchema.safeParse({ availableOnly: 'yes' }).success).toBe(false);
  });
});