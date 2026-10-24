import { describe, it, expect } from 'vitest';
import { MockGateway, cardExpired, detectBrand, luhnValid } from '../src/modules/payments/gateway.js';
import { payChargeSchema } from '../src/modules/payments/payments.schemas.js';

const clock = () => new Date('2026-10-23T00:00:00Z');
const gateway = new MockGateway(clock);
const card = (number: string, expiry = '12/30') => ({ number, expiry, cvv: '123', name: 'A Tester' });

describe('Luhn and brand', () => {
  it('accepts the standard test cards and rejects a bad digit', () => {
    expect(luhnValid('4111111111111111')).toBe(true);
    expect(luhnValid('5555555555554444')).toBe(true);
    expect(luhnValid('4111111111111112')).toBe(false);
  });

  it('detects brands', () => {
    expect(detectBrand('4111111111111111')).toBe('VISA');
    expect(detectBrand('5555555555554444')).toBe('MASTERCARD');
    expect(detectBrand('378282246310005')).toBe('AMEX');
  });

  it('detects expiry at the end of the month', () => {
    expect(cardExpired('09/26', clock())).toBe(true);
    expect(cardExpired('10/26', clock())).toBe(false);
  });
});

describe('MockGateway', () => {
  it('succeeds for UPI with a reference, and fails on request', async () => {
    const ok = await gateway.charge({ method: 'UPI', reference: 'T', amountPaise: 1000, upi: { outcome: 'SUCCESS' } });
    expect(ok.status).toBe('SUCCESS');
    expect(ok.upiRef).toMatch(/^UPI\d{12}$/);
    const bad = await gateway.charge({ method: 'UPI', reference: 'T', amountPaise: 1000, upi: { outcome: 'FAILURE' } });
    expect(bad.status).toBe('FAILED');
  });

  it('succeeds for a valid card and returns only brand and last four', async () => {
    const r = await gateway.charge({ method: 'CARD', reference: 'T', amountPaise: 1000, card: card('4111111111111111') });
    expect(r).toMatchObject({ status: 'SUCCESS', cardBrand: 'VISA', cardLast4: '1111' });
    expect(JSON.stringify(r)).not.toContain('4111111111111111');
  });

  it('declines the failure test cards and expired cards', async () => {
    const a = await gateway.charge({ method: 'CARD', reference: 'T', amountPaise: 1, card: card('4000000000000002') });
    expect(a).toMatchObject({ status: 'FAILED', failureReason: 'Card declined by the issuing bank' });
    const b = await gateway.charge({ method: 'CARD', reference: 'T', amountPaise: 1, card: card('4000000000009995') });
    expect(b.failureReason).toBe('Insufficient funds');
    const c = await gateway.charge({ method: 'CARD', reference: 'T', amountPaise: 1, card: card('4111111111111111', '01/26') });
    expect(c.failureReason).toBe('The card has expired');
  });
});

describe('payChargeSchema', () => {
  it('cleans spaces and dashes in the card number', () => {
    const r = payChargeSchema.parse({ method: 'CARD', cardNumber: '4111 1111-1111 1111', expiry: '12/30', cvv: '123', name: 'A B' });
    expect(r).toMatchObject({ method: 'CARD', cardNumber: '4111111111111111' });
  });

  it('rejects a card that fails Luhn, a bad expiry and a bad cvv', () => {
    const base = { method: 'CARD', cardNumber: '4111111111111111', expiry: '12/30', cvv: '123', name: 'A B' };
    expect(payChargeSchema.safeParse({ ...base, cardNumber: '4111111111111112' }).success).toBe(false);
    expect(payChargeSchema.safeParse({ ...base, expiry: '13/30' }).success).toBe(false);
    expect(payChargeSchema.safeParse({ ...base, cvv: '12' }).success).toBe(false);
  });

  it('accepts a UPI outcome', () => {
    expect(payChargeSchema.safeParse({ method: 'UPI', outcome: 'FAILURE' }).success).toBe(true);
    expect(payChargeSchema.safeParse({ method: 'UPI', outcome: 'MAYBE' }).success).toBe(false);
  });
});
