import { z } from 'zod';

export const roleSchema = z.enum(['CUSTOMER', 'STAFF', 'ADMIN']);

const email = z.string().trim().toLowerCase().email('Enter a valid email address').max(254);
const name = z.string().trim().min(2, 'Name must be at least 2 characters').max(80, 'Name is too long');
const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password is too long')
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/\d/, 'Password must contain a number');

export const registerSchema = z.object({ name, email, password });

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().min(1, 'Email is required'),
  password: z.string().min(1, 'Password is required'),
});

export const createUserSchema = z.object({ name, email, password, role: roleSchema });

export const updateUserSchema = z
  .object({ role: roleSchema.optional(), isActive: z.boolean().optional() })
  .refine((v) => v.role !== undefined || v.isActive !== undefined, {
    message: 'Provide a role or isActive to update',
  });

export const userIdParamSchema = z.object({ id: z.string().min(1).max(64) });