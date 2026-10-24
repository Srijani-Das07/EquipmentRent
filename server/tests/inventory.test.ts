import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import argon2 from 'argon2';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/db.js';
import type { PolicyService } from '../src/config/policy.service.js';

// Integration tests: real HTTP requests through Express into the real PostgreSQL database.
// Test data is identifiable (accounts end in @inv-test.local, tags start with TEST-) and is
// removed before and after the run. A separate email domain keeps this file independent of
// auth.test.ts, which deletes every @test.local account.

const PASSWORD = 'Test@12345';
const app = createApp({ pingDb: async () => {}, policy: {} as PolicyService });
const email = (n: string) => `${n}@inv-test.local`;

async function seedUser(name: string, role: 'ADMIN' | 'STAFF' | 'CUSTOMER') {
  return prisma.user.create({
    data: { email: email(name), name, role, passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }) },
  });
}

async function loginAs(name: string) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email: email(name), password: PASSWORD });
  expect(res.status).toBe(200);
  return agent;
}

async function cleanup() {
  await prisma.booking.deleteMany({ where: { unit: { tag: { startsWith: 'TEST-' } } } });
  await prisma.equipmentUnit.deleteMany({ where: { tag: { startsWith: 'TEST-' } } });
  await prisma.equipment.deleteMany({ where: { name: { startsWith: '[TEST]' } } });
  await prisma.category.deleteMany({ where: { slug: { startsWith: 'test-' } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: '@inv-test.local' } } });
}

let admin: Awaited<ReturnType<typeof loginAs>>;
let staff: Awaited<ReturnType<typeof loginAs>>;
let customer: Awaited<ReturnType<typeof loginAs>>;
let customerId: string;
let categoryId: string;
let equipmentId: string;

beforeAll(async () => {
  await cleanup();
  await seedUser('inv-admin', 'ADMIN');
  await seedUser('inv-staff', 'STAFF');
  customerId = (await seedUser('inv-customer', 'CUSTOMER')).id;
  admin = await loginAs('inv-admin');
  staff = await loginAs('inv-staff');
  customer = await loginAs('inv-customer');
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('categories', () => {
  it('lets anyone list categories without logging in', async () => {
    const res = await request(app).get('/api/categories');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.categories)).toBe(true);
  });

  it('lets an admin create a category and derives the slug from the name', async () => {
    const res = await admin.post('/api/categories').send({ name: 'Test Lab Gear', description: 'Created by tests' });
    expect(res.status).toBe(201);
    expect(res.body.category.slug).toBe('test-lab-gear');
    categoryId = res.body.category.id;
  });

  it('rejects a duplicate category name with 409', async () => {
    const res = await admin.post('/api/categories').send({ name: 'Test Lab Gear' });
    expect(res.status).toBe(409);
  });

  it('blocks guests (401), customers (403) and staff (403) from creating categories', async () => {
    expect((await request(app).post('/api/categories').send({ name: 'Test Nope' })).status).toBe(401);
    expect((await customer.post('/api/categories').send({ name: 'Test Nope' })).status).toBe(403);
    expect((await staff.post('/api/categories').send({ name: 'Test Nope' })).status).toBe(403);
  });
});

describe('equipment catalog', () => {
  it('lets an admin create equipment with prices stored in paise', async () => {
    const res = await admin.post('/api/equipment').send({
      name: '[TEST] Laser Level',
      categoryId,
      description: 'Self-levelling laser level',
      dailyRatePaise: 25000,
      itemValuePaise: 700000,
    });
    expect(res.status).toBe(201);
    expect(res.body.equipment).toMatchObject({ name: '[TEST] Laser Level', dailyRatePaise: 25000, archived: false });
    equipmentId = res.body.equipment.id;
  });

  it('rejects invalid prices with 400 and an unknown category with 404', async () => {
    const bad = { name: '[TEST] Bad', categoryId, dailyRatePaise: -5, itemValuePaise: 1000 };
    expect((await admin.post('/api/equipment').send(bad)).status).toBe(400);
    const missing = { name: '[TEST] Bad', categoryId: 'does-not-exist', dailyRatePaise: 1000, itemValuePaise: 1000 };
    expect((await admin.post('/api/equipment').send(missing)).status).toBe(404);
  });

  it('blocks customers and staff from creating equipment', async () => {
    const body = { name: '[TEST] Nope', categoryId, dailyRatePaise: 1000, itemValuePaise: 1000 };
    expect((await customer.post('/api/equipment').send(body)).status).toBe(403);
    expect((await staff.post('/api/equipment').send(body)).status).toBe(403);
  });

  it('lets a guest search and filter the public catalog', async () => {
    const byName = await request(app).get('/api/equipment').query({ search: 'laser level' });
    expect(byName.status).toBe(200);
    expect(byName.body.items.map((e: { id: string }) => e.id)).toContain(equipmentId);

    const byCategory = await request(app).get('/api/equipment').query({ categoryId });
    expect(byCategory.body.items).toHaveLength(1);

    const none = await request(app).get('/api/equipment').query({ search: 'zzz-no-such-item', categoryId });
    expect(none.body.items).toHaveLength(0);
  });

  it('returns pagination details', async () => {
    const res = await request(app).get('/api/equipment').query({ page: 1, pageSize: 1 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page: 1, pageSize: 1 });
    expect(res.body.items.length).toBeLessThanOrEqual(1);
    expect(res.body.totalPages).toBeGreaterThanOrEqual(1);
  });

  it('returns 404 for an unknown equipment id', async () => {
    expect((await request(app).get('/api/equipment/does-not-exist')).status).toBe(404);
  });
});

describe('units and availability', () => {
  let unitA: string;
  let unitB: string;

  it('lets an admin add units, normalising the tag to upper case', async () => {
    const a = await admin.post(`/api/equipment/${equipmentId}/units`).send({ tag: 'test-001' });
    expect(a.status).toBe(201);
    expect(a.body.unit.tag).toBe('TEST-001');
    unitA = a.body.unit.id;
    const b = await admin.post(`/api/equipment/${equipmentId}/units`).send({ tag: 'TEST-002' });
    expect(b.status).toBe(201);
    unitB = b.body.unit.id;
  });

  it('rejects a duplicate tag with 409 and blocks staff from adding units', async () => {
    expect((await admin.post(`/api/equipment/${equipmentId}/units`).send({ tag: 'TEST-001' })).status).toBe(409);
    expect((await staff.post(`/api/equipment/${equipmentId}/units`).send({ tag: 'TEST-009' })).status).toBe(403);
  });

  it('shows the number of available units on the public item', async () => {
    const res = await request(app).get(`/api/equipment/${equipmentId}`);
    expect(res.body.equipment).toMatchObject({ availableUnits: 2, totalUnits: 2 });
  });

  it('lets staff and admin list units but not customers or guests', async () => {
    const ok = await staff.get(`/api/equipment/${equipmentId}/units`);
    expect(ok.status).toBe(200);
    expect(ok.body.units).toHaveLength(2);
    expect((await customer.get(`/api/equipment/${equipmentId}/units`)).status).toBe(403);
    expect((await request(app).get(`/api/equipment/${equipmentId}/units`)).status).toBe(401);
  });

  it('lets staff send a unit to maintenance, which lowers availability', async () => {
    const res = await staff.patch(`/api/units/${unitA}`).send({ status: 'UNDER_MAINTENANCE' });
    expect(res.status).toBe(200);
    expect(res.body.unit.status).toBe('UNDER_MAINTENANCE');
    const item = await request(app).get(`/api/equipment/${equipmentId}`);
    expect(item.body.equipment.availableUnits).toBe(1);
  });

  it('rejects unknown statuses with 400 and blocks customers from changing status', async () => {
    expect((await staff.patch(`/api/units/${unitA}`).send({ status: 'RENTED' })).status).toBe(400);
    expect((await customer.patch(`/api/units/${unitA}`).send({ status: 'AVAILABLE' })).status).toBe(403);
  });

  it('treats RETIRED as final', async () => {
    expect((await staff.patch(`/api/units/${unitA}`).send({ status: 'RETIRED' })).status).toBe(200);
    expect((await staff.patch(`/api/units/${unitA}`).send({ status: 'AVAILABLE' })).status).toBe(409);
  });

  it('refuses to take a unit with a current booking out of service', async () => {
    const start = new Date(Date.now() + 2 * 86_400_000);
    const end = new Date(Date.now() + 4 * 86_400_000);
    await prisma.booking.create({
      data: {
        reference: 'TEST-BKG-1',
        customerId,
        unitId: unitB,
        startAt: start,
        endAt: end,
        rentalDays: 2,
        dailyRatePaise: 25000,
        costPaise: 50000,
        status: 'CONFIRMED',
      },
    });
    const res = await staff.patch(`/api/units/${unitB}`).send({ status: 'UNDER_MAINTENANCE' });
    expect(res.status).toBe(409);
  });
});

describe('archiving equipment', () => {
  it('refuses to archive equipment that has a current booking', async () => {
    const res = await admin.patch(`/api/equipment/${equipmentId}`).send({ archived: true });
    expect(res.status).toBe(409);
  });

  it('hides archived equipment from the public but keeps it visible to staff', async () => {
    await prisma.booking.deleteMany({ where: { reference: 'TEST-BKG-1' } });
    const archived = await admin.patch(`/api/equipment/${equipmentId}`).send({ archived: true });
    expect(archived.status).toBe(200);
    expect(archived.body.equipment.archived).toBe(true);

    expect((await request(app).get(`/api/equipment/${equipmentId}`)).status).toBe(404);
    const publicList = await request(app).get('/api/equipment').query({ categoryId });
    expect(publicList.body.items).toHaveLength(0);

    const manage = await staff.get('/api/equipment/manage').query({ categoryId });
    expect(manage.status).toBe(200);
    expect(manage.body.items[0]).toMatchObject({ id: equipmentId, archived: true });
  });

  it('protects the management listing from guests and customers', async () => {
    expect((await request(app).get('/api/equipment/manage')).status).toBe(401);
    expect((await customer.get('/api/equipment/manage')).status).toBe(403);
  });

  it('lets an admin restore archived equipment', async () => {
    const res = await admin.patch(`/api/equipment/${equipmentId}`).send({ archived: false });
    expect(res.status).toBe(200);
    expect(res.body.equipment.archived).toBe(false);
  });
});


describe('availability filter and removal rules (F7, F8, F9)', () => {
  let unitId: string;

  it('filters the catalog to equipment with at least one available unit', async () => {
    const units = await staff.get(`/api/equipment/${equipmentId}/units`);
    unitId = units.body.units.find((u: { status: string }) => u.status === 'AVAILABLE').id;

    const before = await request(app).get('/api/equipment').query({ categoryId, availableOnly: 'true' });
    expect(before.body.items).toHaveLength(1);

    await staff.patch(`/api/units/${unitId}`).send({ status: 'UNDER_MAINTENANCE' });
    const after = await request(app).get('/api/equipment').query({ categoryId, availableOnly: 'true' });
    expect(after.body.items).toHaveLength(0);

    const all = await request(app).get('/api/equipment').query({ categoryId });
    expect(all.body.items).toHaveLength(1);
  });

  it('refuses to delete a category that still has equipment, and blocks non-admins', async () => {
    expect((await admin.delete(`/api/categories/${categoryId}`)).status).toBe(409);
    expect((await staff.delete(`/api/categories/${categoryId}`)).status).toBe(403);
    expect((await customer.delete(`/api/categories/${categoryId}`)).status).toBe(403);
  });

  it('refuses to delete equipment that has booking history', async () => {
    await prisma.booking.create({
      data: {
        reference: 'TEST-BKG-2',
        customerId,
        unitId,
        startAt: new Date(Date.now() - 4 * 86_400_000),
        endAt: new Date(Date.now() - 2 * 86_400_000),
        rentalDays: 2,
        dailyRatePaise: 25000,
        costPaise: 50000,
        status: 'COMPLETED',
      },
    });
    const res = await admin.delete(`/api/equipment/${equipmentId}`);
    expect(res.status).toBe(409);
  });

  it('deletes never-rented equipment with its units, then allows deleting the empty category', async () => {
    await prisma.booking.deleteMany({ where: { reference: 'TEST-BKG-2' } });
    expect((await staff.delete(`/api/equipment/${equipmentId}`)).status).toBe(403);

    expect((await admin.delete(`/api/equipment/${equipmentId}`)).status).toBe(204);
    expect(await prisma.equipmentUnit.count({ where: { equipmentId } })).toBe(0);
    expect((await admin.get(`/api/equipment/${equipmentId}/units`)).status).toBe(404);

    expect((await admin.delete(`/api/categories/${categoryId}`)).status).toBe(204);
    const categories = await request(app).get('/api/categories');
    expect(categories.body.categories.map((c: { id: string }) => c.id)).not.toContain(categoryId);
  });
});