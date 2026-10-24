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
import { applyLateFee } from '../src/modules/payments/payments.service.js';

// Integration tests for bookings, payments and receipts against the real PostgreSQL database.
// Test data uses its own markers (@bk-test.local accounts, BKT- tags, [BKT] names, bkt- categories)
// so this file is independent of the auth and inventory test files.

const PASSWORD = 'Test@12345';
let dir: string;
let policy: PolicyService;
let app: ReturnType<typeof createApp>;
const email = (n: string) => `${n}@bk-test.local`;
const DAY = 86_400_000;
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
  const bookings = { booking: { customer: { email: { endsWith: '@bk-test.local' } } } };
  await prisma.receipt.deleteMany({ where: { payment: { charge: bookings } } });
  await prisma.payment.deleteMany({ where: { charge: bookings } });
  await prisma.charge.deleteMany({ where: bookings });
  await prisma.booking.deleteMany({ where: { customer: { email: { endsWith: '@bk-test.local' } } } });
  await prisma.equipmentUnit.deleteMany({ where: { tag: { startsWith: 'BKT-' } } });
  await prisma.equipment.deleteMany({ where: { name: { startsWith: '[BKT]' } } });
  await prisma.category.deleteMany({ where: { slug: { startsWith: 'bkt-' } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: '@bk-test.local' } } });
}

let customer: Awaited<ReturnType<typeof loginAs>>;
let other: Awaited<ReturnType<typeof loginAs>>;
let staff: Awaited<ReturnType<typeof loginAs>>;
let admin: Awaited<ReturnType<typeof loginAs>>;
let customerId: string;
let categoryId: string;
let tz: string;
let today: string;
const date = (offset: number) => addDays(today, offset);

async function makeEquipment(label: string, units: number, rateRupees = 1000) {
  const equipment = await prisma.equipment.create({
    data: { name: `[BKT] ${label}`, categoryId, dailyRatePaise: rateRupees * 100, itemValuePaise: 5_000_000 },
  });
  for (let i = 1; i <= units; i++) {
    await prisma.equipmentUnit.create({ data: { equipmentId: equipment.id, tag: `BKT-${label}-${i}` } });
  }
  return equipment;
}

const UPI_OK = { method: 'UPI', outcome: 'SUCCESS' };

async function book(agent: typeof customer, equipmentId: string, startOffset: number, endOffset: number) {
  return agent.post('/api/bookings').send({ equipmentId, startDate: date(startOffset), endDate: date(endOffset) });
}

async function payBooking(agent: typeof customer, booking: { charges: Array<{ id: string; type: string }> }) {
  const charge = booking.charges.find((c) => c.type === 'BOOKING')!;
  return agent.post(`/api/charges/${charge.id}/pay`).send(UPI_OK);
}

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'booking-'));
  const file = path.join(dir, 'policy.json');
  await fs.copyFile(path.resolve('config/equipment_policy_config.json'), file);
  policy = new PolicyService({ filePath: file, versionsDir: path.join(dir, 'versions') });
  await policy.start();
  app = createApp({ pingDb: async () => {}, policy });
  tz = policy.getSystem().timezone;
  today = dateInZone(new Date(), tz);

  await cleanup();
  customerId = (await seedUser('bk-customer', 'CUSTOMER')).id;
  await seedUser('bk-other', 'CUSTOMER');
  await seedUser('bk-staff', 'STAFF');
  await seedUser('bk-admin', 'ADMIN');
  categoryId = (await prisma.category.create({ data: { slug: 'bkt-cat', name: 'BKT Category' } })).id;
  customer = await loginAs('bk-customer');
  other = await loginAs('bk-other');
  staff = await loginAs('bk-staff');
  admin = await loginAs('bk-admin');
});

afterAll(async () => {
  policy.stop();
  await cleanup();
  await fs.rm(dir, { recursive: true, force: true });
  await prisma.$disconnect();
});

describe('availability and quote', () => {
  it('shows the availability calendar publicly', async () => {
    const eq = await makeEquipment('cal', 2);
    const month = date(5).slice(0, 7);
    const res = await request(app).get(`/api/bookings/availability/${eq.id}?month=${month}`);
    expect(res.status).toBe(200);
    expect(res.body.totalUnits).toBe(2);
    expect(res.body.days.length).toBeGreaterThanOrEqual(28);
  });

  it('quotes a price for customers only', async () => {
    const eq = await makeEquipment('quote', 1, 500);
    const body = { equipmentId: eq.id, startDate: date(10), endDate: date(13) };
    const res = await customer.post('/api/bookings/quote').send(body);
    expect(res.status).toBe(200);
    expect(res.body.quote).toMatchObject({ days: 3, costPaise: 150000, available: true });
    expect((await staff.post('/api/bookings/quote').send(body)).status).toBe(403);
    expect((await request(app).post('/api/bookings/quote').send(body)).status).toBe(401);
  });

  it('rejects past, reversed and over-long ranges', async () => {
    const eq = await makeEquipment('range', 1);
    expect((await book(customer, eq.id, -3, -1)).status).toBe(400);
    expect((await book(customer, eq.id, 5, 5)).status).toBe(400);
    expect((await book(customer, eq.id, 5, 60)).status).toBe(400);
  });
});

describe('booking and payment flow', () => {
  it('creates a pending booking with a hold, then confirms it only after payment', async () => {
    const eq = await makeEquipment('flow', 1, 1000);
    const created = await book(customer, eq.id, 20, 22);
    expect(created.status).toBe(201);
    const booking = created.body.booking;
    expect(booking).toMatchObject({ status: 'PENDING', costPaise: 200000, rentalDays: 2 });
    expect(booking.holdExpiresAt).toBeTruthy();
    expect(booking.charges).toHaveLength(1);

    const paid = await payBooking(customer, booking);
    expect(paid.status).toBe(200);
    expect(paid.body.payment).toMatchObject({ status: 'SUCCESS' });
    expect(paid.body.payment.receiptId).toBeTruthy();

    const after = await customer.get(`/api/bookings/${booking.id}`);
    expect(after.body.booking.status).toBe('CONFIRMED');
    expect(after.body.booking.holdExpiresAt).toBeNull();

    const receipt = await customer.get(`/api/receipts/${paid.body.payment.receiptId}`);
    expect(receipt.status).toBe(200);
    expect(JSON.stringify(receipt.body)).not.toMatch(/cvv/i);
    expect((await other.get(`/api/receipts/${paid.body.payment.receiptId}`)).status).toBe(404);
    expect((await customer.get('/api/receipts')).body.receipts.length).toBeGreaterThan(0);
  });

  it('keeps a booking pending when payment fails, and allows a retry', async () => {
    const eq = await makeEquipment('fail', 1);
    const booking = (await book(customer, eq.id, 30, 31)).body.booking;
    const charge = booking.charges[0];
    const failed = await customer.post(`/api/charges/${charge.id}/pay`).send({ method: 'UPI', outcome: 'FAILURE' });
    expect(failed.status).toBe(200);
    expect(failed.body.payment.status).toBe('FAILED');
    expect((await customer.get(`/api/bookings/${booking.id}`)).body.booking.status).toBe('PENDING');

    const declined = await customer
      .post(`/api/charges/${charge.id}/pay`)
      .send({ method: 'CARD', cardNumber: '4000000000000002', expiry: '12/35', cvv: '123', name: 'A Tester' });
    expect(declined.body.payment.status).toBe('FAILED');

    const ok = await customer
      .post(`/api/charges/${charge.id}/pay`)
      .send({ method: 'CARD', cardNumber: '4111111111111111', expiry: '12/35', cvv: '123', name: 'A Tester' });
    expect(ok.body.payment.status).toBe('SUCCESS');
    expect((await customer.get(`/api/bookings/${booking.id}`)).body.booking.status).toBe('CONFIRMED');

    const stored = await prisma.payment.findMany({ where: { chargeId: charge.id, status: 'SUCCESS' } });
    expect(stored[0]).toMatchObject({ cardBrand: 'VISA', cardLast4: '1111' });
    expect(await prisma.payment.count({ where: { chargeId: charge.id } })).toBe(3);
  });

  it('refuses to pay a charge twice', async () => {
    const eq = await makeEquipment('twice', 1);
    const booking = (await book(customer, eq.id, 40, 41)).body.booking;
    await payBooking(customer, booking);
    expect((await payBooking(customer, booking)).status).toBe(409);
  });

  it('hides bookings and charges from other customers', async () => {
    const eq = await makeEquipment('private', 1);
    const booking = (await book(customer, eq.id, 45, 46)).body.booking;
    expect((await other.get(`/api/bookings/${booking.id}`)).status).toBe(404);
    expect((await other.get(`/api/charges/${booking.charges[0].id}`)).status).toBe(404);
    expect((await other.post(`/api/charges/${booking.charges[0].id}/pay`).send(UPI_OK)).status).toBe(404);
    expect((await staff.get(`/api/bookings/${booking.id}`)).status).toBe(200);
    expect((await customer.get('/api/bookings/manage')).status).toBe(403);
    expect((await staff.get('/api/bookings/manage')).body.items.length).toBeGreaterThan(0);
  });

  it('only lets customers create bookings', async () => {
    const eq = await makeEquipment('roles', 1);
    expect((await book(staff, eq.id, 50, 51)).status).toBe(403);
    expect((await book(admin, eq.id, 50, 51)).status).toBe(403);
  });
});

describe('availability rules', () => {
  it('returns 409 with alternative dates when everything is taken (U1)', async () => {
    const eq = await makeEquipment('full', 1);
    expect((await book(customer, eq.id, 60, 63)).status).toBe(201);
    const clash = await book(other, eq.id, 61, 64);
    expect(clash.status).toBe(409);
    expect(clash.body.error.details.alternatives.length).toBeGreaterThan(0);
  });

  it('allows back to back bookings of the same unit', async () => {
    const eq = await makeEquipment('b2b', 1);
    expect((await book(customer, eq.id, 70, 72)).status).toBe(201);
    expect((await book(other, eq.id, 72, 74)).status).toBe(201);
  });

  it('skips units that are due for maintenance (F24)', async () => {
    const eq = await makeEquipment('maint', 1);
    await prisma.equipmentUnit.updateMany({ where: { equipmentId: eq.id }, data: { maintenanceDue: true } });
    expect((await book(customer, eq.id, 80, 81)).status).toBe(409);
  });

  it('releases an expired hold so the unit can be booked again', async () => {
    const eq = await makeEquipment('hold', 1);
    const first = (await book(customer, eq.id, 85, 87)).body.booking;
    await prisma.booking.update({ where: { id: first.id }, data: { holdExpiresAt: new Date(Date.now() - 1000) } });
    expect((await book(other, eq.id, 85, 87)).status).toBe(201);
    expect((await customer.get(`/api/bookings/${first.id}`)).body.booking.status).toBe('CANCELLED');
    const pay = await customer.post(`/api/charges/${first.charges[0].id}/pay`).send(UPI_OK);
    expect(pay.status).toBe(409);
  });

  it('never double-books under concurrent requests (P3)', async () => {
    const eq = await makeEquipment('race', 3);
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => (i % 2 ? customer : other).post('/api/bookings').send({
        equipmentId: eq.id,
        startDate: date(100),
        endDate: date(103),
      })),
    );
    const created = results.filter((r) => r.status === 201);
    const refused = results.filter((r) => r.status === 409);
    expect(created).toHaveLength(3);
    expect(refused).toHaveLength(17);
    const units = new Set(created.map((r) => r.body.booking.unitTag));
    expect(units.size).toBe(3);
  });
});

describe('cancelling and modifying', () => {
  it('cancels a pending booking for free and frees the unit', async () => {
    const eq = await makeEquipment('cpend', 1);
    const booking = (await book(customer, eq.id, 110, 112)).body.booking;
    const res = await customer.post(`/api/bookings/${booking.id}/cancel`);
    expect(res.status).toBe(200);
    expect(res.body.booking.status).toBe('CANCELLED');
    expect(res.body.cancellation).toMatchObject({ free: true, feePaise: 0 });
    expect((await book(other, eq.id, 110, 112)).status).toBe(201);
  });

  it('refunds in full for an early cancel of a paid booking', async () => {
    const eq = await makeEquipment('cearly', 1, 1000);
    const booking = (await book(customer, eq.id, 120, 122)).body.booking;
    await payBooking(customer, booking);
    const preview = await customer.get(`/api/bookings/${booking.id}/cancel-preview`);
    expect(preview.body.preview).toMatchObject({ free: true, feePaise: 0, refundPaise: 200000 });
    const res = await customer.post(`/api/bookings/${booking.id}/cancel`);
    expect(res.body.cancellation).toMatchObject({ feePaise: 0, refundPaise: 200000 });
    const refunds = await prisma.payment.findMany({ where: { kind: 'REFUND', charge: { bookingId: booking.id } } });
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({ amountPaise: 200000, status: 'SUCCESS' });
  });

  it('keeps a late cancellation fee and refunds the rest (F14)', async () => {
    const eq = await makeEquipment('clate', 1, 1000);
    const booking = (await book(customer, eq.id, 130, 132)).body.booking;
    await payBooking(customer, booking);
    await prisma.booking.update({
      where: { id: booking.id },
      data: { startAt: hoursFromNow(5), endAt: new Date(hoursFromNow(5).getTime() + 2 * DAY) },
    });
    const pct = policy.getPolicy({ equipmentId: eq.id, categorySlug: 'bkt-cat' }).lateCancellationFeePct;
    const fee = Math.round((200000 * pct) / 100);
    const res = await customer.post(`/api/bookings/${booking.id}/cancel`);
    expect(res.status).toBe(200);
    expect(res.body.cancellation).toMatchObject({ free: false, feePaise: fee, refundPaise: 200000 - fee });
  });

  it('modifies a pending booking and updates the amount due', async () => {
    const eq = await makeEquipment('mpend', 1, 1000);
    const booking = (await book(customer, eq.id, 140, 142)).body.booking;
    const res = await customer.patch(`/api/bookings/${booking.id}`).send({ startDate: date(140), endDate: date(144) });
    expect(res.status).toBe(200);
    expect(res.body.booking).toMatchObject({ rentalDays: 4, costPaise: 400000 });
    expect(res.body.booking.charges[0].amountPaise).toBe(400000);
  });

  it('creates an adjustment charge when a confirmed booking gets longer, and refunds when shorter', async () => {
    const eq = await makeEquipment('mconf', 1, 1000);
    const booking = (await book(customer, eq.id, 150, 152)).body.booking;
    await payBooking(customer, booking);

    const longer = await customer.patch(`/api/bookings/${booking.id}`).send({ startDate: date(150), endDate: date(154) });
    expect(longer.status).toBe(200);
    const adjustment = longer.body.booking.charges.find((c: { type: string }) => c.type === 'BOOKING_ADJUSTMENT');
    expect(adjustment).toMatchObject({ amountPaise: 200000, status: 'PENDING' });
    expect((await customer.post(`/api/charges/${adjustment.id}/pay`).send(UPI_OK)).body.payment.status).toBe('SUCCESS');

    const shorter = await customer.patch(`/api/bookings/${booking.id}`).send({ startDate: date(150), endDate: date(151) });
    expect(shorter.status).toBe(200);
    const refunds = await prisma.payment.findMany({ where: { kind: 'REFUND', charge: { bookingId: booking.id } } });
    expect(refunds.map((r) => r.amountPaise)).toEqual([300000]);
  });

  it('rejects a modification that clashes with another booking', async () => {
    const eq = await makeEquipment('mclash', 1);
    await book(other, eq.id, 164, 166);
    const mine = (await book(customer, eq.id, 160, 162)).body.booking;
    const res = await customer.patch(`/api/bookings/${mine.id}`).send({ startDate: date(160), endDate: date(165) });
    expect(res.status).toBe(409);
  });

  it('cannot cancel or modify someone else\'s booking', async () => {
    const eq = await makeEquipment('cother', 1);
    const booking = (await book(customer, eq.id, 170, 171)).body.booking;
    expect((await other.post(`/api/bookings/${booking.id}/cancel`)).status).toBe(404);
    expect((await other.patch(`/api/bookings/${booking.id}`).send({ startDate: date(170), endDate: date(172) })).status).toBe(404);
  });
});

describe('handover and late fees', () => {
  it('hands over a confirmed booking and then blocks cancel and modify (U2)', async () => {
    const eq = await makeEquipment('hand', 1);
    const booking = (await book(customer, eq.id, 180, 182)).body.booking;
    await payBooking(customer, booking);

    expect((await staff.post(`/api/bookings/${booking.id}/handover`)).status).toBe(409); // too early
    await prisma.booking.update({
      where: { id: booking.id },
      data: { startAt: hoursFromNow(-1), endAt: hoursFromNow(47) },
    });
    expect((await customer.post(`/api/bookings/${booking.id}/handover`)).status).toBe(403);
    const res = await staff.post(`/api/bookings/${booking.id}/handover`);
    expect(res.status).toBe(200);
    expect(res.body.booking.status).toBe('ACTIVE');
    expect((await customer.post(`/api/bookings/${booking.id}/cancel`)).status).toBe(409);
    expect((await customer.patch(`/api/bookings/${booking.id}`).send({ startDate: date(181), endDate: date(183) })).status).toBe(409);
  });

  it('blocks handover while a charge is unpaid', async () => {
    const eq = await makeEquipment('handpend', 1);
    const booking = (await book(customer, eq.id, 190, 192)).body.booking;
    await payBooking(customer, booking);
    await customer.patch(`/api/bookings/${booking.id}`).send({ startDate: date(190), endDate: date(193) });
    await prisma.booking.update({
      where: { id: booking.id },
      data: { startAt: hoursFromNow(-1), endAt: hoursFromNow(71) },
    });
    expect((await staff.post(`/api/bookings/${booking.id}/handover`)).status).toBe(409);
  });

  it('applies the per-day late fee (F17)', async () => {
    const eq = await makeEquipment('latefee', 1);
    const booking = (await book(customer, eq.id, 200, 201)).body.booking;
    // Returned before the due date: no fee.
    expect(await applyLateFee(booking.id, new Date(), policy)).toBeNull();

    await prisma.booking.update({
      where: { id: booking.id },
      data: { startAt: hoursFromNow(-72), endAt: hoursFromNow(-47) },
    });
    const late = await applyLateFee(booking.id, new Date(), policy);
    const perDay = policy.getPolicy({ equipmentId: eq.id, categorySlug: 'bkt-cat' }).lateFeePerDay;
    expect(late).not.toBeNull();
    expect(late!.amountPaise).toBe(perDay * 100 * 2);
    expect(late!.type).toBe('LATE_FEE');
  });
});

describe('listing', () => {
  it('lists only the caller\'s bookings and charges', async () => {
    const mine = await customer.get('/api/bookings');
    expect(mine.status).toBe(200);
    expect(mine.body.items.every((b: { customer: { id: string } }) => b.customer.id === customerId)).toBe(true);
    const pending = await customer.get('/api/charges?status=PENDING');
    expect(pending.body.charges.every((c: { status: string }) => c.status === 'PENDING')).toBe(true);
  });
});
