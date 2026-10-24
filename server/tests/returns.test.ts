import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import argon2 from 'argon2';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/db.js';
import { PolicyService } from '../src/config/policy.service.js';
import { addDays, dateInZone } from '../src/lib/time.js';

// Integration tests for returns (Module 5) and maintenance (Module 6) against the real database.
// Own markers: @rt-test.local accounts, RTT- tags, [RTT] names, rtt- categories.

const PASSWORD = 'Test@12345';
const ITEM_VALUE = 5_000_000; // paise
let dir: string;
let policy: PolicyService;
let app: ReturnType<typeof createApp>;
const email = (n: string) => `${n}@rt-test.local`;
const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000);

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
  const mine = { booking: { customer: { email: { endsWith: '@rt-test.local' } } } };
  await prisma.returnRecord.deleteMany({ where: mine });
  await prisma.receipt.deleteMany({ where: { payment: { charge: mine } } });
  await prisma.payment.deleteMany({ where: { charge: mine } });
  await prisma.charge.deleteMany({ where: mine });
  await prisma.booking.deleteMany({ where: { customer: { email: { endsWith: '@rt-test.local' } } } });
  await prisma.maintenanceLog.deleteMany({ where: { unit: { tag: { startsWith: 'RTT-' } } } });
  await prisma.equipmentUnit.deleteMany({ where: { tag: { startsWith: 'RTT-' } } });
  await prisma.equipment.deleteMany({ where: { name: { startsWith: '[RTT]' } } });
  await prisma.category.deleteMany({ where: { slug: { startsWith: 'rtt-' } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: '@rt-test.local' } } });
}

let customer: Awaited<ReturnType<typeof loginAs>>;
let staff: Awaited<ReturnType<typeof loginAs>>;
let categoryId: string;
let today: string;
const date = (offset: number) => addDays(today, offset);
let counter = 0;

async function makeEquipment(units: number) {
  counter += 1;
  const equipment = await prisma.equipment.create({
    data: { name: `[RTT] item ${counter}`, categoryId, dailyRatePaise: 100000, itemValuePaise: ITEM_VALUE },
  });
  for (let i = 1; i <= units; i++) {
    await prisma.equipmentUnit.create({ data: { equipmentId: equipment.id, tag: `RTT-${counter}-${i}` } });
  }
  return equipment;
}

async function bookAndPay(equipmentId: string, startOffset: number, endOffset: number) {
  const created = await customer.post('/api/bookings').send({
    equipmentId,
    startDate: date(startOffset),
    endDate: date(endOffset),
  });
  expect(created.status).toBe(201);
  const booking = created.body.booking;
  const paid = await customer.post(`/api/charges/${booking.charges[0].id}/pay`).send({ method: 'UPI', outcome: 'SUCCESS' });
  expect(paid.body.payment.status).toBe('SUCCESS');
  return booking as { id: string; unitTag: string };
}

/** Puts a paid booking into the Active state with a chosen due time, as if handover had happened. */
async function makeActive(bookingId: string, dueInHours: number) {
  await prisma.booking.update({
    where: { id: bookingId },
    data: { status: 'ACTIVE', startAt: hoursFromNow(dueInHours - 72), endAt: hoursFromNow(dueInHours), handedOverAt: new Date() },
  });
}

const unitOf = (tag: string) => prisma.equipmentUnit.findUniqueOrThrow({ where: { tag } });

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'returns-'));
  const file = path.join(dir, 'policy.json');
  await fs.copyFile(path.resolve('config/equipment_policy_config.json'), file);
  policy = new PolicyService({ filePath: file, versionsDir: path.join(dir, 'versions') });
  await policy.start();
  app = createApp({ pingDb: async () => {}, policy });
  today = dateInZone(new Date(), policy.getSystem().timezone);

  await cleanup();
  await seedUser('rt-customer', 'CUSTOMER');
  await seedUser('rt-staff', 'STAFF');
  categoryId = (await prisma.category.create({ data: { slug: 'rtt-cat', name: 'RTT Category' } })).id;
  customer = await loginAs('rt-customer');
  staff = await loginAs('rt-staff');
});

afterAll(async () => {
  policy.stop();
  await cleanup();
  await fs.rm(dir, { recursive: true, force: true });
  await prisma.$disconnect();
});

describe('returns', () => {
  it('completes an on-time return in good condition with no extra charges', async () => {
    const eq = await makeEquipment(1);
    const booking = await bookAndPay(eq.id, 10, 12);
    await makeActive(booking.id, 24);

    const res = await staff.post('/api/returns').send({ bookingId: booking.id, condition: 'GOOD' });
    expect(res.status).toBe(201);
    expect(res.body.booking.status).toBe('COMPLETED');
    expect(res.body).toMatchObject({ lateFeePaise: 0, damagePenaltyPaise: 0 });
    expect(res.body.booking.charges).toHaveLength(1);

    const unit = await unitOf(booking.unitTag);
    expect(unit).toMatchObject({ status: 'AVAILABLE', lifetimeRentals: 1, rentalsSinceMaintenance: 1, maintenanceDue: false });
    expect(await prisma.returnRecord.count({ where: { bookingId: booking.id } })).toBe(1);
  });

  it('applies the per-day late fee, which the customer can then pay (F17)', async () => {
    const eq = await makeEquipment(1);
    const booking = await bookAndPay(eq.id, 15, 17);
    await makeActive(booking.id, -47); // due 47 hours ago: 2 days late

    const perDay = policy.getPolicy({ equipmentId: eq.id, categorySlug: 'rtt-cat' }).lateFeePerDay;
    const res = await staff.post('/api/returns').send({ bookingId: booking.id, condition: 'GOOD' });
    expect(res.status).toBe(201);
    expect(res.body.returnRecord.daysLate).toBe(2);
    expect(res.body.lateFeePaise).toBe(perDay * 100 * 2);

    const fee = res.body.booking.charges.find((c: { type: string }) => c.type === 'LATE_FEE');
    expect(fee).toMatchObject({ amountPaise: perDay * 100 * 2, status: 'PENDING' });
    const paid = await customer.post(`/api/charges/${fee.id}/pay`).send({ method: 'UPI', outcome: 'SUCCESS' });
    expect(paid.body.payment.status).toBe('SUCCESS');
  });

  it('charges the minor damage penalty and sends the unit to maintenance (F20, F21, F24)', async () => {
    const eq = await makeEquipment(1);
    const booking = await bookAndPay(eq.id, 20, 22);
    await makeActive(booking.id, 24);

    const tiers = policy.getPolicy({ equipmentId: eq.id, categorySlug: 'rtt-cat' }).damagePenaltyPct;
    const expected = Math.round((ITEM_VALUE * tiers.minor) / 100);
    const res = await staff.post('/api/returns').send({ bookingId: booking.id, condition: 'MINOR_DAMAGE', notes: 'Scratched lens' });
    expect(res.status).toBe(201);
    expect(res.body.damagePenaltyPaise).toBe(expected);
    expect(res.body.unit).toMatchObject({ status: 'UNDER_MAINTENANCE', maintenanceTrigger: 'DAMAGE' });

    const unit = await unitOf(booking.unitTag);
    expect(unit).toMatchObject({ status: 'UNDER_MAINTENANCE', maintenanceDue: true, maintenanceReason: 'DAMAGE' });
    const log = await prisma.maintenanceLog.findFirstOrThrow({ where: { unitId: unit.id, clearedAt: null } });
    expect(log.notes).toContain('Scratched lens');

    // F24: the only unit is out of service, so it cannot be booked.
    const blocked = await customer.post('/api/bookings').send({ equipmentId: eq.id, startDate: date(40), endDate: date(41) });
    expect(blocked.status).toBe(409);
  });

  it('charges the full item value and retires a lost unit', async () => {
    const eq = await makeEquipment(1);
    const booking = await bookAndPay(eq.id, 25, 27);
    await makeActive(booking.id, 24);

    const res = await staff.post('/api/returns').send({ bookingId: booking.id, condition: 'LOST' });
    expect(res.status).toBe(201);
    expect(res.body.damagePenaltyPaise).toBe(ITEM_VALUE);
    expect((await unitOf(booking.unitTag)).status).toBe('RETIRED');
  });

  it('previews the amounts before submitting (P2)', async () => {
    const eq = await makeEquipment(1);
    const booking = await bookAndPay(eq.id, 30, 32);
    await makeActive(booking.id, -47);

    const res = await staff.get(`/api/returns/preview?bookingId=${booking.id}&condition=MAJOR_DAMAGE`);
    expect(res.status).toBe(200);
    const tiers = policy.getPolicy({ equipmentId: eq.id, categorySlug: 'rtt-cat' });
    expect(res.body.preview).toMatchObject({
      daysLate: 2,
      damagePenaltyPct: tiers.damagePenaltyPct.major,
      damagePenaltyPaise: Math.round((ITEM_VALUE * tiers.damagePenaltyPct.major) / 100),
      lateFeePaise: tiers.lateFeePerDay * 100 * 2,
    });
    expect(await prisma.returnRecord.count({ where: { bookingId: booking.id } })).toBe(0); // preview changes nothing
  });

  it('only staff can process returns, and only for active bookings, once', async () => {
    const eq = await makeEquipment(1);
    const booking = await bookAndPay(eq.id, 35, 37);

    expect((await customer.post('/api/returns').send({ bookingId: booking.id, condition: 'GOOD' })).status).toBe(403);
    expect((await staff.post('/api/returns').send({ bookingId: booking.id, condition: 'GOOD' })).status).toBe(409); // still Confirmed

    await makeActive(booking.id, 24);
    expect((await staff.post('/api/returns').send({ bookingId: booking.id, condition: 'GOOD' })).status).toBe(201);
    expect((await staff.post('/api/returns').send({ bookingId: booking.id, condition: 'GOOD' })).status).toBe(409); // already returned
  });

  it('moves an upcoming booking to another unit when the returned unit goes to maintenance', async () => {
    const eq = await makeEquipment(2);
    const active = await bookAndPay(eq.id, 45, 47);
    await makeActive(active.id, 24);
    const upcoming = await bookAndPay(eq.id, 60, 62);
    expect(upcoming.unitTag).toBe(active.unitTag); // both on the same unit before the return

    const res = await staff.post('/api/returns').send({ bookingId: active.id, condition: 'MAJOR_DAMAGE' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ upcomingBookingsMoved: 1, upcomingBookingsNeedingAttention: 0 });

    const moved = await customer.get(`/api/bookings/${upcoming.id}`);
    expect(moved.body.booking.unitTag).not.toBe(active.unitTag);
  });
});

describe('maintenance queue', () => {
  it('flags a unit when the rental interval is reached, then staff clear it (F22, F23, U6)', async () => {
    const eq = await makeEquipment(1);
    const interval = policy.getPolicy({ equipmentId: eq.id, categorySlug: 'rtt-cat' }).maintenanceIntervalRentals;
    const booking = await bookAndPay(eq.id, 70, 72);
    await prisma.equipmentUnit.updateMany({ where: { equipmentId: eq.id }, data: { rentalsSinceMaintenance: interval - 1 } });
    await makeActive(booking.id, 24);

    const res = await staff.post('/api/returns').send({ bookingId: booking.id, condition: 'GOOD' });
    expect(res.body.unit).toMatchObject({ status: 'UNDER_MAINTENANCE', maintenanceTrigger: 'PERIODIC' });

    const unit = await unitOf(booking.unitTag);
    const queue = await staff.get('/api/maintenance');
    expect(queue.status).toBe(200);
    expect(queue.body.items.some((i: { unitId: string; reason: string }) => i.unitId === unit.id && i.reason === 'PERIODIC')).toBe(true);

    const cleared = await staff.post(`/api/maintenance/units/${unit.id}/clear`).send({ notes: 'Serviced and tested' });
    expect(cleared.status).toBe(200);
    expect(await unitOf(booking.unitTag)).toMatchObject({
      status: 'AVAILABLE',
      maintenanceDue: false,
      maintenanceReason: null,
      rentalsSinceMaintenance: 0,
    });

    const history = await staff.get('/api/maintenance?view=cleared');
    const entry = history.body.items.find((i: { unitId: string }) => i.unitId === unit.id);
    expect(entry.notes).toContain('Serviced and tested');
    expect(entry.clearedBy).toBe('rt-staff');

    // Bookable again.
    const again = await customer.post('/api/bookings').send({ equipmentId: eq.id, startDate: date(80), endDate: date(81) });
    expect(again.status).toBe(201);
  });

  it('is staff only, and refuses units that are not in the queue or are retired', async () => {
    const eq = await makeEquipment(1);
    const unit = await prisma.equipmentUnit.findFirstOrThrow({ where: { equipmentId: eq.id } });

    expect((await customer.get('/api/maintenance')).status).toBe(403);
    expect((await customer.post(`/api/maintenance/units/${unit.id}/clear`).send({})).status).toBe(403);
    expect((await staff.post(`/api/maintenance/units/${unit.id}/clear`).send({})).status).toBe(409); // not in queue

    await prisma.equipmentUnit.update({ where: { id: unit.id }, data: { status: 'RETIRED' } });
    expect((await staff.post(`/api/maintenance/units/${unit.id}/clear`).send({})).status).toBe(409);
  });
});

describe('handover with a unit in maintenance', () => {
  it('swaps in another free unit, or refuses when none is free', async () => {
    const eq = await makeEquipment(2);
    const booking = await bookAndPay(eq.id, 90, 92);
    const unit = await unitOf(booking.unitTag);
    await prisma.equipmentUnit.update({ where: { id: unit.id }, data: { status: 'UNDER_MAINTENANCE' } });
    await prisma.booking.update({ where: { id: booking.id }, data: { startAt: hoursFromNow(-1), endAt: hoursFromNow(47) } });

    const ok = await staff.post(`/api/bookings/${booking.id}/handover`);
    expect(ok.status).toBe(200);
    expect(ok.body.booking.unitTag).not.toBe(booking.unitTag);

    const eq2 = await makeEquipment(1);
    const solo = await bookAndPay(eq2.id, 95, 97);
    await prisma.equipmentUnit.updateMany({ where: { equipmentId: eq2.id }, data: { status: 'UNDER_MAINTENANCE' } });
    await prisma.booking.update({ where: { id: solo.id }, data: { startAt: hoursFromNow(-1), endAt: hoursFromNow(47) } });
    expect((await staff.post(`/api/bookings/${solo.id}/handover`)).status).toBe(409);
  });
});
