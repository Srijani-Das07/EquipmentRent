import { api } from './client';
import type { Booking } from './bookings';

export type Condition = 'GOOD' | 'MINOR_DAMAGE' | 'MAJOR_DAMAGE' | 'LOST';

export const conditionLabel: Record<Condition, string> = {
  GOOD: 'Good',
  MINOR_DAMAGE: 'Minor damage',
  MAJOR_DAMAGE: 'Major damage',
  LOST: 'Lost',
};

export interface ReturnPreview {
  bookingId: string;
  dueAt: string;
  returnedAt: string;
  daysLate: number;
  lateFeePaise: number;
  damagePenaltyPct: number;
  itemValuePaise: number;
  damagePenaltyPaise: number;
  totalPaise: number;
  unitStatusAfter: 'AVAILABLE' | 'UNDER_MAINTENANCE' | 'RETIRED';
  maintenanceTrigger: 'DAMAGE' | 'PERIODIC' | null;
}

export interface ReturnResult {
  booking: Booking;
  returnRecord: { condition: Condition; daysLate: number; notes: string | null };
  lateFeePaise: number;
  damagePenaltyPaise: number;
  unit: { tag: string; status: 'AVAILABLE' | 'UNDER_MAINTENANCE' | 'RETIRED'; maintenanceTrigger: 'DAMAGE' | 'PERIODIC' | null };
  upcomingBookingsMoved: number;
  upcomingBookingsNeedingAttention: number;
}

export interface QueueItem {
  unitId: string;
  tag: string;
  equipmentId: string;
  equipmentName: string;
  category: string;
  status: 'AVAILABLE' | 'UNDER_MAINTENANCE' | 'RETIRED';
  maintenanceDue: boolean;
  reason: 'DAMAGE' | 'PERIODIC' | null;
  notes: string | null;
  openedAt: string | null;
  rentalsSinceMaintenance: number;
  lifetimeRentals: number;
  upcomingBookings: number;
}

export interface HistoryItem {
  logId: string;
  unitId: string;
  tag: string;
  equipmentName: string;
  trigger: 'DAMAGE' | 'PERIODIC';
  notes: string | null;
  openedAt: string;
  clearedAt: string;
  clearedBy: string | null;
}

export const returnsApi = {
  preview: (bookingId: string, condition: Condition) =>
    api.get<{ preview: ReturnPreview }>(`/returns/preview?bookingId=${encodeURIComponent(bookingId)}&condition=${condition}`).then((r) => r.preview),
  process: (input: { bookingId: string; condition: Condition; notes?: string }) => api.post<ReturnResult>('/returns', input),
};

export const maintenanceApi = {
  open: () => api.get<{ view: 'open'; items: QueueItem[] }>('/maintenance?view=open').then((r) => r.items),
  cleared: () => api.get<{ view: 'cleared'; items: HistoryItem[] }>('/maintenance?view=cleared').then((r) => r.items),
  clear: (unitId: string, notes?: string) => api.post<{ unit: { unitId: string; tag: string } }>(`/maintenance/units/${unitId}/clear`, { notes }),
};
