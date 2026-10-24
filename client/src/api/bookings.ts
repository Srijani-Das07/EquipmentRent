import { api } from './client';

export type BookingStatus = 'PENDING' | 'CONFIRMED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
export type ChargeStatus = 'PENDING' | 'PAID' | 'FAILED' | 'VOID';
export type ChargeType = 'BOOKING' | 'BOOKING_ADJUSTMENT' | 'LATE_CANCELLATION' | 'LATE_FEE' | 'DAMAGE_PENALTY';

export interface BookingCharge {
  id: string;
  type: ChargeType;
  amountPaise: number;
  status: ChargeStatus;
  description: string;
  createdAt: string;
  paidAt: string | null;
}

export interface Booking {
  id: string;
  reference: string;
  status: BookingStatus;
  startAt: string;
  endAt: string;
  rentalDays: number;
  dailyRatePaise: number;
  costPaise: number;
  holdExpiresAt: string | null;
  handedOverAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  equipment: { id: string; name: string; category: string };
  unitTag: string;
  customer: { id: string; name: string; email: string };
  charges: BookingCharge[];
  pendingPaise: number;
  canChange: boolean;
}

export interface BookingPage {
  items: Booking[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface AlternativeWindow {
  startDate: string;
  endDate: string;
}

export interface Quote {
  equipmentId: string;
  equipmentName: string;
  startAt: string;
  endAt: string;
  days: number;
  dailyRatePaise: number;
  costPaise: number;
  available: boolean;
  freeUnits: number;
  alternatives: AlternativeWindow[];
}

export interface CalendarDay {
  date: string;
  free: number;
}

export interface Calendar {
  month: string;
  totalUnits: number;
  today: string;
  days: CalendarDay[];
}

export interface CancelOutcome {
  free: boolean;
  feePaise: number;
  refundPaise: number;
}

export interface CancelPreview extends CancelOutcome {
  lateCancellationFeePct: number;
  paidPaise: number;
}

export interface RangeInput {
  equipmentId: string;
  startDate: string;
  endDate: string;
}

export interface ChargeRow {
  id: string;
  type: ChargeType;
  amountPaise: number;
  status: ChargeStatus;
  description: string;
  createdAt: string;
  paidAt: string | null;
  booking: {
    id: string;
    reference: string;
    status: BookingStatus;
    holdExpiresAt: string | null;
    startAt: string;
    endAt: string;
    equipmentName: string;
  };
}

export interface PaymentResult {
  status: 'SUCCESS' | 'FAILED';
  failureReason: string | null;
  receiptId: string | null;
}

export type PayInput =
  | { method: 'UPI'; outcome: 'SUCCESS' | 'FAILURE' }
  | { method: 'CARD'; cardNumber: string; expiry: string; cvv: string; name: string };

export interface ReceiptSummary {
  id: string;
  receiptNumber: string;
  issuedAt: string;
  kind: 'PAYMENT' | 'REFUND';
  amountPaise: number;
  method: 'UPI' | 'CARD';
}

export interface ReceiptPayload {
  kind: 'PAYMENT' | 'REFUND';
  receiptNumber: string;
  issuedAt: string;
  customer: { name: string; email: string };
  booking: { reference: string; equipment: string; unitTag: string; startAt: string; endAt: string; days: number };
  charge: { type: ChargeType; description: string };
  payment: {
    reference: string;
    method: 'UPI' | 'CARD';
    cardBrand: string | null;
    cardLast4: string | null;
    upiRef: string | null;
    amountPaise: number;
    amountText: string;
  };
}

export interface Receipt {
  id: string;
  receiptNumber: string;
  issuedAt: string;
  payload: ReceiptPayload;
}

const qs = (params: Record<string, string | number | undefined>) => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : '';
};

export const bookingsApi = {
  calendar: (equipmentId: string, month: string) => api.get<Calendar>(`/bookings/availability/${equipmentId}${qs({ month })}`),
  quote: (input: RangeInput) => api.post<{ quote: Quote }>('/bookings/quote', input).then((r) => r.quote),
  create: (input: RangeInput) => api.post<{ booking: Booking }>('/bookings', input).then((r) => r.booking),
  mine: (params: { status?: string; page?: number } = {}) => api.get<BookingPage>(`/bookings${qs(params)}`),
  manage: (params: { status?: string; search?: string; page?: number } = {}) =>
    api.get<BookingPage>(`/bookings/manage${qs(params)}`),
  get: (id: string) => api.get<{ booking: Booking }>(`/bookings/${id}`).then((r) => r.booking),
  cancelPreview: (id: string) => api.get<{ preview: CancelPreview }>(`/bookings/${id}/cancel-preview`).then((r) => r.preview),
  cancel: (id: string) => api.post<{ booking: Booking; cancellation: CancelOutcome }>(`/bookings/${id}/cancel`),
  modify: (id: string, input: { startDate: string; endDate: string }) =>
    api.patch<{ booking: Booking }>(`/bookings/${id}`, input).then((r) => r.booking),
  handover: (id: string) => api.post<{ booking: Booking }>(`/bookings/${id}/handover`).then((r) => r.booking),
};

export const paymentsApi = {
  charges: (status?: ChargeStatus) => api.get<{ charges: ChargeRow[] }>(`/charges${qs({ status })}`).then((r) => r.charges),
  charge: (id: string) => api.get<{ charge: ChargeRow }>(`/charges/${id}`).then((r) => r.charge),
  pay: (id: string, input: PayInput) => api.post<{ payment: PaymentResult }>(`/charges/${id}/pay`, input).then((r) => r.payment),
  receipts: () => api.get<{ receipts: ReceiptSummary[] }>('/receipts').then((r) => r.receipts),
  receipt: (id: string) => api.get<{ receipt: Receipt }>(`/receipts/${id}`).then((r) => r.receipt),
};

export const statusTone = (s: BookingStatus): 'ok' | 'bad' | 'wait' =>
  s === 'CONFIRMED' || s === 'ACTIVE' || s === 'COMPLETED' ? 'ok' : s === 'CANCELLED' ? 'bad' : 'wait';

export const chargeLabel: Record<ChargeType, string> = {
  BOOKING: 'Booking',
  BOOKING_ADJUSTMENT: 'Date change difference',
  LATE_CANCELLATION: 'Late cancellation fee',
  LATE_FEE: 'Late return fee',
  DAMAGE_PENALTY: 'Damage penalty',
};

export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
export const formatDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { dateStyle: 'medium' });

/** YYYY-MM-DD in the browser's local zone. */
export const toDateInput = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
