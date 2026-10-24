import { Prisma, type ChargeStatus, type Payment } from '@prisma/client';
import { prisma } from '../../lib/db.js';
import { AppError } from '../../lib/errors.js';
import { makeReference } from '../../lib/ids.js';
import { formatINR } from '../../lib/money.js';
import type { PolicyService } from '../../config/policy.service.js';
import { expireStaleHolds } from '../bookings/holds.js';
import { daysLate, lateFeePaise } from './fees.js';
import type { PaymentProvider } from './gateway.js';
import type { PayChargeInput } from './payments.schemas.js';

type Db = Prisma.TransactionClient;

const chargeInclude = {
  booking: {
    include: {
      customer: { select: { id: true, name: true, email: true } },
      unit: { include: { equipment: { include: { category: true } } } },
    },
  },
} satisfies Prisma.ChargeInclude;

type ChargeRow = Prisma.ChargeGetPayload<{ include: typeof chargeInclude }>;

const isUniqueViolation = (err: unknown): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

// ---- DTOs ---------------------------------------------------------------------

export function toChargeDto(c: ChargeRow) {
  return {
    id: c.id,
    type: c.type,
    amountPaise: c.amountPaise,
    status: c.status,
    description: c.description,
    createdAt: c.createdAt,
    paidAt: c.paidAt,
    booking: {
      id: c.booking.id,
      reference: c.booking.reference,
      status: c.booking.status,
      holdExpiresAt: c.booking.holdExpiresAt,
      startAt: c.booking.startAt,
      endAt: c.booking.endAt,
      equipmentName: c.booking.unit.equipment.name,
    },
  };
}

// ---- charges ------------------------------------------------------------------

export async function listCharges(customerId: string, status?: ChargeStatus) {
  await expireStaleHolds();
  const rows = await prisma.charge.findMany({
    where: { booking: { customerId }, ...(status ? { status } : {}) },
    include: chargeInclude,
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(toChargeDto);
}

export async function getCharge(customerId: string, chargeId: string) {
  await expireStaleHolds();
  const row = await prisma.charge.findUnique({ where: { id: chargeId }, include: chargeInclude });
  if (!row || row.booking.customerId !== customerId) throw AppError.notFound('Charge not found');
  return toChargeDto(row);
}

// ---- receipts -----------------------------------------------------------------

/** The details frozen onto a receipt. Card numbers and CVVs are never part of it (S3). */
function buildReceiptPayload(ctx: ChargeRow, payment: Payment, receiptNumber: string, issuedAt: Date) {
  const booking = ctx.booking;
  return {
    kind: payment.kind,
    receiptNumber,
    issuedAt: issuedAt.toISOString(),
    customer: { name: booking.customer.name, email: booking.customer.email },
    booking: {
      reference: booking.reference,
      equipment: booking.unit.equipment.name,
      unitTag: booking.unit.tag,
      startAt: booking.startAt.toISOString(),
      endAt: booking.endAt.toISOString(),
      days: booking.rentalDays,
    },
    charge: { type: ctx.type, description: ctx.description },
    payment: {
      reference: payment.paymentRef,
      method: payment.method,
      cardBrand: payment.cardBrand,
      cardLast4: payment.cardLast4,
      upiRef: payment.upiRef,
      amountPaise: payment.amountPaise,
      amountText: formatINR(payment.amountPaise),
    },
  };
}

async function createReceipt(db: Db, ctx: ChargeRow, payment: Payment, now: Date) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const receiptNumber = makeReference('RC', now, 6);
    try {
      return await db.receipt.create({
        data: {
          receiptNumber,
          paymentId: payment.id,
          issuedAt: now,
          payload: buildReceiptPayload(ctx, payment, receiptNumber, now),
        },
      });
    } catch (err) {
      if (!isUniqueViolation(err) || attempt === 2) throw err;
    }
  }
  throw new Error('unreachable');
}

export async function listReceipts(customerId: string) {
  const rows = await prisma.receipt.findMany({
    where: { payment: { charge: { booking: { customerId } } } },
    include: { payment: { select: { kind: true, amountPaise: true, method: true } } },
    orderBy: { issuedAt: 'desc' },
  });
  return rows.map((r) => ({
    id: r.id,
    receiptNumber: r.receiptNumber,
    issuedAt: r.issuedAt,
    kind: r.payment.kind,
    amountPaise: r.payment.amountPaise,
    method: r.payment.method,
  }));
}

export async function getReceipt(user: { id: string; role: string }, receiptId: string) {
  const row = await prisma.receipt.findUnique({
    where: { id: receiptId },
    include: { payment: { include: { charge: { include: { booking: { select: { customerId: true } } } } } } },
  });
  if (!row) throw AppError.notFound('Receipt not found');
  if (user.role === 'CUSTOMER' && row.payment.charge.booking.customerId !== user.id) {
    throw AppError.notFound('Receipt not found');
  }
  return { id: row.id, receiptNumber: row.receiptNumber, issuedAt: row.issuedAt, payload: row.payload };
}

// ---- paying a charge (F16) ------------------------------------------------------

/**
 * Pays a charge through the gateway. For a booking charge, the booking becomes Confirmed in
 * the same database transaction that records the successful payment, so a booking can never
 * be Confirmed without payment (reliability requirement). A failed payment is recorded and
 * the charge stays pending so the customer can try again.
 */
export async function payCharge(
  customerId: string,
  chargeId: string,
  input: PayChargeInput,
  gateway: PaymentProvider,
  now: Date = new Date(),
) {
  await expireStaleHolds(now);

  const charge = await prisma.charge.findUnique({ where: { id: chargeId }, include: chargeInclude });
  if (!charge || charge.booking.customerId !== customerId) throw AppError.notFound('Charge not found');
  if (charge.status === 'PAID') throw AppError.conflict('This charge has already been paid');
  if (charge.status !== 'PENDING') throw AppError.conflict('This charge can no longer be paid');
  if (charge.type === 'BOOKING' && charge.booking.status !== 'PENDING') {
    throw AppError.conflict('This booking is no longer waiting for payment');
  }
  if (charge.booking.status === 'PENDING' && charge.booking.holdExpiresAt && charge.booking.holdExpiresAt <= now) {
    throw AppError.conflict('The payment hold has expired. Please book again.');
  }

  const paymentRef = makeReference('PAY', now, 8);
  const result = await gateway.charge({
    method: input.method,
    amountPaise: charge.amountPaise,
    reference: paymentRef,
    ...(input.method === 'CARD'
      ? { card: { number: input.cardNumber, expiry: input.expiry, cvv: input.cvv, name: input.name } }
      : { upi: { outcome: input.outcome } }),
  });

  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.create({
      data: {
        paymentRef,
        chargeId,
        kind: 'PAYMENT',
        method: input.method,
        amountPaise: charge.amountPaise,
        status: result.status === 'SUCCESS' ? 'SUCCESS' : 'FAILED',
        cardBrand: result.cardBrand ?? null,
        cardLast4: result.cardLast4 ?? null,
        upiRef: result.upiRef ?? null,
        failureReason: result.failureReason ?? null,
        completedAt: now,
      },
    });

    if (result.status === 'FAILED') {
      return { status: 'FAILED' as const, failureReason: result.failureReason ?? 'Payment failed', receiptId: null };
    }

    const claimed = await tx.charge.updateMany({
      where: { id: chargeId, status: 'PENDING' },
      data: { status: 'PAID', paidAt: now },
    });
    if (claimed.count !== 1) throw AppError.conflict('This charge has already been paid');

    if (charge.type === 'BOOKING') {
      const confirmed = await tx.booking.updateMany({
        where: { id: charge.bookingId, status: 'PENDING', holdExpiresAt: { gt: now } },
        data: { status: 'CONFIRMED', holdExpiresAt: null },
      });
      if (confirmed.count !== 1) throw AppError.conflict('The payment hold has expired. Please book again.');
    }

    const receipt = await createReceipt(tx, charge, payment, now);
    return { status: 'SUCCESS' as const, failureReason: null, receiptId: receipt.id };
  });
}

// ---- refunds (F13, F14) -----------------------------------------------------------

/** Money actually paid for a booking and its date-change adjustments, minus refunds so far. */
export async function refundableBase(db: Db, bookingId: string): Promise<number> {
  const rows = await db.payment.findMany({
    where: { status: 'SUCCESS', charge: { bookingId, type: { in: ['BOOKING', 'BOOKING_ADJUSTMENT'] } } },
    select: { kind: true, amountPaise: true },
  });
  return rows.reduce((sum, p) => sum + (p.kind === 'PAYMENT' ? p.amountPaise : -p.amountPaise), 0);
}

/** Mock refund to the original payment method, with its own receipt. */
export async function issueRefund(db: Db, input: { bookingId: string; amountPaise: number; now: Date }) {
  const original = await db.charge.findFirst({
    where: { bookingId: input.bookingId, type: 'BOOKING', status: 'PAID' },
    include: chargeInclude,
  });
  const payment = original
    ? await db.payment.findFirst({
        where: { chargeId: original.id, kind: 'PAYMENT', status: 'SUCCESS' },
        orderBy: { completedAt: 'desc' },
      })
    : null;
  if (!original || !payment) throw AppError.conflict('No payment was found to refund');

  const refund = await db.payment.create({
    data: {
      paymentRef: makeReference('RFD', input.now, 8),
      chargeId: original.id,
      kind: 'REFUND',
      method: payment.method,
      amountPaise: input.amountPaise,
      status: 'SUCCESS',
      cardBrand: payment.cardBrand,
      cardLast4: payment.cardLast4,
      upiRef: payment.upiRef,
      completedAt: input.now,
    },
  });
  return createReceipt(db, original, refund, input.now);
}

// ---- late fee (F17) -----------------------------------------------------------------

/**
 * Creates the late-return charge when equipment comes back after its due time. Module 5
 * (returns) calls this; the fee per day comes from the policy file (item, then category,
 * then default). Returns null when the return is on time.
 */
export async function applyLateFee(
  bookingId: string,
  returnedAt: Date,
  policy: PolicyService,
  db: Db = prisma,
) {
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    include: { unit: { include: { equipment: { include: { category: true } } } } },
  });
  if (!booking) throw AppError.notFound('Booking not found');

  const lateDays = daysLate(booking.endAt, returnedAt);
  if (lateDays === 0) return null;

  const equipment = booking.unit.equipment;
  const perDay = policy.getPolicy({ equipmentId: equipment.id, categorySlug: equipment.category.slug }).lateFeePerDay;
  const amount = lateFeePaise(perDay, lateDays);

  return db.charge.create({
    data: {
      bookingId,
      type: 'LATE_FEE',
      amountPaise: amount,
      description: `Late return of ${equipment.name}: ${lateDays} day(s) at ${formatINR(perDay * 100)} per day`,
      policySnapshot: {
        lateFeePerDay: perDay,
        daysLate: lateDays,
        dueAt: booking.endAt.toISOString(),
        returnedAt: returnedAt.toISOString(),
      },
    },
  });
}
