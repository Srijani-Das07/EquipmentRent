import { ApiError, api } from './client';

export type Role = 'CUSTOMER' | 'STAFF' | 'ADMIN';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
}

export interface LoginInput {
  email: string;
  password: string;
}
export interface RegisterInput {
  name: string;
  email: string;
  password: string;
}
export interface CreateUserInput extends RegisterInput {
  role: Role;
}
export interface UpdateUserInput {
  role?: Role;
  isActive?: boolean;
}

export const authApi = {
  me: () => api.get<{ user: User }>('/auth/me'),
  login: (input: LoginInput) => api.post<{ user: User }>('/auth/login', input),
  register: (input: RegisterInput) => api.post<{ user: User }>('/auth/register', input),
  logout: () => api.post<{ ok: true }>('/auth/logout'),
};

export const usersApi = {
  list: () => api.get<{ users: User[] }>('/users'),
  create: (input: CreateUserInput) => api.post<{ user: User }>('/users', input),
  update: (id: string, patch: UpdateUserInput) => api.patch<{ user: User }>(`/users/${id}`, patch),
};

export const roleLabel: Record<Role, string> = {
  CUSTOMER: 'Customer',
  STAFF: 'Staff',
  ADMIN: 'Admin',
};

export const homeFor = (role: Role): string =>
  role === 'ADMIN' ? '/admin' : role === 'STAFF' ? '/staff' : '/customer';

/** Turns the API's validation error details into { fieldName: message }. */
export function fieldErrors(err: unknown): Record<string, string> {
  if (!(err instanceof ApiError) || !Array.isArray(err.details)) return {};
  const out: Record<string, string> = {};
  for (const d of err.details as Array<{ path?: string; message?: string }>) {
    if (d.path && d.message && !out[d.path]) out[d.path] = d.message;
  }
  return out;
}