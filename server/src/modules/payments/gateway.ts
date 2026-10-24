/**
 * Mock payment gateway. It sits behind the PaymentProvider interface, so a real gateway
 * can replace it without touching the rest of the code (the SRS only needs an amount in and
 * a success or failure out). No real money moves, and card details are never stored.
 */
import { randomInt } from 'node:crypto';

export type PaymentMethodName = 'UPI' | 'CARD';

export interface GatewayRequest {
  method: PaymentMethodName;
  amountPaise: number;
  reference: string;
  card?: { number: string; expiry: string; cvv: string; name: string };
  upi?: { outcome: 'SUCCESS' | 'FAILURE' };
}

export interface GatewayResult {
  status: 'SUCCESS' | 'FAILED';
  failureReason?: string;
  cardBrand?: string;
  cardLast4?: string;
  upiRef?: string;
}

export interface PaymentProvider {
  charge(request: GatewayRequest): Promise<GatewayResult>;
}

/** Luhn checksum used by real card numbers. */
export function luhnValid(number: string): boolean {
  if (!/^\d+$/.test(number)) return false;
  let sum = 0;
  let double = false;
  for (let i = number.length - 1; i >= 0; i--) {
    let digit = Number(number[i]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

export function detectBrand(number: string): string {
  if (/^4/.test(number)) return 'VISA';
  if (/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/.test(number)) return 'MASTERCARD';
  if (/^3[47]/.test(number)) return 'AMEX';
  if (/^(60|65|81|82|508)/.test(number)) return 'RUPAY';
  return 'CARD';
}

/** True when the last day of the card's expiry month is before `now`. */
export function cardExpired(expiry: string, now: Date): boolean {
  const [mm = '0', yy = '0'] = expiry.split('/');
  const month = Number(mm);
  const year = 2000 + Number(yy);
  const endOfMonth = Date.UTC(year, month, 1); // first instant of the following month
  return endOfMonth <= now.getTime();
}

/** Test card numbers that always decline, so the failure path can be demonstrated. */
const DECLINES: Record<string, string> = {
  '4000000000000002': 'Card declined by the issuing bank',
  '4000000000009995': 'Insufficient funds',
};

export class MockGateway implements PaymentProvider {
  constructor(private readonly clock: () => Date = () => new Date()) {}

  async charge(request: GatewayRequest): Promise<GatewayResult> {
    if (request.method === 'UPI') {
      if (request.upi?.outcome === 'FAILURE') {
        return { status: 'FAILED', failureReason: 'The payment was declined in the UPI app' };
      }
      return { status: 'SUCCESS', upiRef: `UPI${String(randomInt(0, 1_000_000_000_000)).padStart(12, '0')}` };
    }

    const card = request.card;
    if (!card) return { status: 'FAILED', failureReason: 'Card details are missing' };

    const base = { cardBrand: detectBrand(card.number), cardLast4: card.number.slice(-4) };
    if (cardExpired(card.expiry, this.clock())) return { status: 'FAILED', failureReason: 'The card has expired', ...base };
    const decline = DECLINES[card.number];
    if (decline) return { status: 'FAILED', failureReason: decline, ...base };
    return { status: 'SUCCESS', ...base };
  }
}
