import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/db.js';
import { AppError } from '../../lib/errors.js';
import {
  canTransition,
  slugify,
  tallyUnits,
  type UnitStatusName,
} from './inventory.rules.js';
import type { CreateEquipmentInput, EquipmentListQuery, UpdateEquipmentInput } from './inventory.schemas.js';

// ---- helpers -----------------------------------------------------------------

const isUniqueViolation = (err: unknown): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

/**
 * True when any of the given units is tied to a booking that is still current:
 * confirmed or active and not yet ended, or pending with an unexpired payment hold.
 */
async function hasOpenBookings(unitIds: string[]): Promise<boolean> {
  if (unitIds.length === 0) return false;
  const now = new Date();
  const count = await prisma.booking.count({
    where: {
      unitId: { in: unitIds },
      endAt: { gt: now },
      OR: [
        { status: { in: ['CONFIRMED', 'ACTIVE'] } },
        { status: 'PENDING', holdExpiresAt: { gt: now } },
      ],
    },
  });
  return count > 0;
}

const equipmentInclude = {
  category: { select: { id: true, name: true, slug: true } },
  units: { select: { status: true } },
} satisfies Prisma.EquipmentInclude;

type EquipmentRow = Prisma.EquipmentGetPayload<{ include: typeof equipmentInclude }>;

function toEquipmentDto(row: EquipmentRow) {
  const counts = tallyUnits(row.units);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    dailyRatePaise: row.dailyRatePaise,
    itemValuePaise: row.itemValuePaise,
    category: row.category,
    archived: row.retiredAt !== null,
    availableUnits: counts.available,
    totalUnits: counts.total,
    unitCounts: counts,
  };
}

// ---- categories --------------------------------------------------------------

export async function listCategories() {
  const rows = await prisma.category.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { equipment: { where: { retiredAt: null } } } } },
  });
  return rows.map((c) => ({
    id: c.id,
    slug: c.slug,
    name: c.name,
    description: c.description,
    equipmentCount: c._count.equipment,
  }));
}

export async function createCategory(input: { name: string; description?: string }) {
  const slug = slugify(input.name);
  if (!slug) throw AppError.badRequest('Category name must contain letters or numbers');
  try {
    const c = await prisma.category.create({
      data: { name: input.name, slug, description: input.description ?? null },
    });
    return { id: c.id, slug: c.slug, name: c.name, description: c.description, equipmentCount: 0 };
  } catch (err) {
    if (isUniqueViolation(err)) throw AppError.conflict('A category with that name already exists');
    throw err;
  }
}

/** The slug is deliberately never changed: policy overrides refer to categories by slug. */
export async function updateCategory(id: string, input: { name?: string; description?: string }) {
  try {
    const c = await prisma.category.update({
      where: { id },
      data: { name: input.name, description: input.description },
    });
    return { id: c.id, slug: c.slug, name: c.name, description: c.description };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw AppError.notFound('Category not found');
    }
    if (isUniqueViolation(err)) throw AppError.conflict('A category with that name already exists');
    throw err;
  }
}

// ---- equipment ---------------------------------------------------------------

export async function listEquipment(query: EquipmentListQuery, opts: { publicOnly: boolean }) {
  const where: Prisma.EquipmentWhereInput = {};
  if (opts.publicOnly || query.archived === 'active') where.retiredAt = null;
  else if (query.archived === 'archived') where.retiredAt = { not: null };
  if (query.categoryId) where.categoryId = query.categoryId;
  if (query.availableOnly) where.units = { some: { status: 'AVAILABLE' } };
  if (query.search) {
    where.OR = [
      { name: { contains: query.search, mode: 'insensitive' } },
      { description: { contains: query.search, mode: 'insensitive' } },
    ];
  }

  const [total, rows] = await Promise.all([
    prisma.equipment.count({ where }),
    prisma.equipment.findMany({
      where,
      include: equipmentInclude,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  return {
    items: rows.map(toEquipmentDto),
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}

export async function getEquipment(id: string, opts: { publicOnly: boolean }) {
  const row = await prisma.equipment.findUnique({ where: { id }, include: equipmentInclude });
  if (!row || (opts.publicOnly && row.retiredAt !== null)) throw AppError.notFound('Equipment not found');
  return toEquipmentDto(row);
}

export async function createEquipment(input: CreateEquipmentInput) {
  const category = await prisma.category.findUnique({ where: { id: input.categoryId } });
  if (!category) throw AppError.notFound('Category not found');
  const row = await prisma.equipment.create({
    data: {
      name: input.name,
      description: input.description,
      categoryId: input.categoryId,
      dailyRatePaise: input.dailyRatePaise,
      itemValuePaise: input.itemValuePaise,
    },
    include: equipmentInclude,
  });
  return toEquipmentDto(row);
}

export async function updateEquipment(id: string, input: UpdateEquipmentInput) {
  const existing = await prisma.equipment.findUnique({ where: { id }, include: { units: { select: { id: true } } } });
  if (!existing) throw AppError.notFound('Equipment not found');

  if (input.categoryId && input.categoryId !== existing.categoryId) {
    const category = await prisma.category.findUnique({ where: { id: input.categoryId } });
    if (!category) throw AppError.notFound('Category not found');
  }

  const data: Prisma.EquipmentUncheckedUpdateInput = {
    name: input.name,
    description: input.description,
    categoryId: input.categoryId,
    dailyRatePaise: input.dailyRatePaise,
    itemValuePaise: input.itemValuePaise,
  };

  if (input.archived === true && existing.retiredAt === null) {
    if (await hasOpenBookings(existing.units.map((u) => u.id))) {
      throw AppError.conflict('Cannot archive equipment that has current bookings');
    }
    data.retiredAt = new Date();
  } else if (input.archived === false) {
    data.retiredAt = null;
  }

  const row = await prisma.equipment.update({ where: { id }, data, include: equipmentInclude });
  return toEquipmentDto(row);
}

// ---- units -------------------------------------------------------------------

const unitSelect = {
  id: true,
  equipmentId: true,
  tag: true,
  status: true,
  lifetimeRentals: true,
  rentalsSinceMaintenance: true,
  maintenanceDue: true,
  createdAt: true,
} satisfies Prisma.EquipmentUnitSelect;

export async function listUnits(equipmentId: string) {
  const equipment = await prisma.equipment.findUnique({ where: { id: equipmentId }, select: { id: true } });
  if (!equipment) throw AppError.notFound('Equipment not found');
  return prisma.equipmentUnit.findMany({ where: { equipmentId }, select: unitSelect, orderBy: { tag: 'asc' } });
}

export async function createUnit(equipmentId: string, tag: string) {
  const equipment = await prisma.equipment.findUnique({ where: { id: equipmentId } });
  if (!equipment) throw AppError.notFound('Equipment not found');
  if (equipment.retiredAt !== null) throw AppError.conflict('Cannot add units to archived equipment');
  try {
    return await prisma.equipmentUnit.create({ data: { equipmentId, tag }, select: unitSelect });
  } catch (err) {
    if (isUniqueViolation(err)) throw AppError.conflict(`A unit with tag ${tag} already exists`);
    throw err;
  }
}

export async function changeUnitStatus(id: string, to: UnitStatusName) {
  const unit = await prisma.equipmentUnit.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!unit) throw AppError.notFound('Unit not found');

  if (!canTransition(unit.status, to)) {
    throw AppError.conflict(`Cannot change a unit from ${unit.status} to ${to}`);
  }
  if (to !== 'AVAILABLE' && (await hasOpenBookings([id]))) {
    throw AppError.conflict('This unit has a current booking and cannot be taken out of service');
  }
  return prisma.equipmentUnit.update({ where: { id }, data: { status: to }, select: unitSelect });
}

/** F9: a category that still has equipment (active or archived) cannot be removed. */
export async function deleteCategory(id: string) {
  const category = await prisma.category.findUnique({
    where: { id },
    include: { _count: { select: { equipment: true } } },
  });
  if (!category) throw AppError.notFound('Category not found');
  if (category._count.equipment > 0) {
    throw AppError.conflict(
      `This category still has ${category._count.equipment} equipment item(s). Reassign or delete them first.`,
    );
  }
  await prisma.category.delete({ where: { id } });
}

/**
 * F7: removes equipment that has never been rented. Anything with booking or maintenance
 * history is kept for the audit trail and must be archived instead.
 */
export async function deleteEquipment(id: string) {
  const equipment = await prisma.equipment.findUnique({ where: { id }, include: { units: { select: { id: true } } } });
  if (!equipment) throw AppError.notFound('Equipment not found');

  const unitIds = equipment.units.map((u) => u.id);
  if (unitIds.length > 0) {
    const [bookings, logs] = await Promise.all([
      prisma.booking.count({ where: { unitId: { in: unitIds } } }),
      prisma.maintenanceLog.count({ where: { unitId: { in: unitIds } } }),
    ]);
    if (bookings > 0 || logs > 0) {
      throw AppError.conflict('This equipment has booking or maintenance history and cannot be deleted. Archive it instead.');
    }
  }

  await prisma.$transaction([
    prisma.equipmentUnit.deleteMany({ where: { equipmentId: id } }),
    prisma.equipment.delete({ where: { id } }),
  ]);
}