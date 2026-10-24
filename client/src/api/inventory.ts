import { api } from './client';

export type UnitStatus = 'AVAILABLE' | 'UNDER_MAINTENANCE' | 'RETIRED';

export interface Category {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  equipmentCount?: number;
}

export interface UnitCounts {
  available: number;
  underMaintenance: number;
  retired: number;
  total: number;
}

export interface Equipment {
  id: string;
  name: string;
  description: string;
  dailyRatePaise: number;
  itemValuePaise: number;
  category: { id: string; name: string; slug: string };
  archived: boolean;
  availableUnits: number;
  totalUnits: number;
  unitCounts: UnitCounts;
}

export interface Unit {
  id: string;
  equipmentId: string;
  tag: string;
  status: UnitStatus;
  lifetimeRentals: number;
  rentalsSinceMaintenance: number;
  maintenanceDue: boolean;
}

export interface EquipmentPage {
  items: Equipment[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface EquipmentQuery {
  search?: string;
  categoryId?: string;
  availableOnly?: boolean;
  page?: number;
  pageSize?: number;
  archived?: 'active' | 'archived' | 'all';
}

export interface EquipmentInput {
  name: string;
  categoryId: string;
  description: string;
  dailyRatePaise: number;
  itemValuePaise: number;
}

const qs = (q: EquipmentQuery) => {
  const p = new URLSearchParams();
  Object.entries(q).forEach(([k, v]) => {
    if (v !== undefined && v !== '') p.set(k, String(v));
  });
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const inventoryApi = {
  categories: () => api.get<{ categories: Category[] }>('/categories').then((r) => r.categories),
  createCategory: (body: { name: string; description?: string }) =>
    api.post<{ category: Category }>('/categories', body).then((r) => r.category),

  updateCategory: (id: string, body: { name?: string; description?: string }) =>
    api.patch<{ category: Category }>(`/categories/${id}`, body).then((r) => r.category),
  deleteCategory: (id: string) => api.delete<void>(`/categories/${id}`),
  list: (q: EquipmentQuery) => api.get<EquipmentPage>(`/equipment${qs(q)}`),
  manageList: (q: EquipmentQuery) => api.get<EquipmentPage>(`/equipment/manage${qs(q)}`),
  get: (id: string) => api.get<{ equipment: Equipment }>(`/equipment/${id}`).then((r) => r.equipment),
  create: (body: EquipmentInput) => api.post<{ equipment: Equipment }>('/equipment', body).then((r) => r.equipment),
  update: (id: string, body: Partial<EquipmentInput> & { archived?: boolean }) =>
    api.patch<{ equipment: Equipment }>(`/equipment/${id}`, body).then((r) => r.equipment),

  remove: (id: string) => api.delete<void>(`/equipment/${id}`),
  
  units: (equipmentId: string) => api.get<{ units: Unit[] }>(`/equipment/${equipmentId}/units`).then((r) => r.units),
  addUnit: (equipmentId: string, tag: string) =>
    api.post<{ unit: Unit }>(`/equipment/${equipmentId}/units`, { tag }).then((r) => r.unit),
  setUnitStatus: (unitId: string, status: UnitStatus) =>
    api.patch<{ unit: Unit }>(`/units/${unitId}`, { status }).then((r) => r.unit),
};

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });
export const formatPaise = (paise: number) => inr.format(paise / 100);
export const rupeesToPaise = (rupees: number) => Math.round(rupees * 100);

export const statusLabel: Record<UnitStatus, string> = {
  AVAILABLE: 'Available',
  UNDER_MAINTENANCE: 'Under maintenance',
  RETIRED: 'Retired',
};
