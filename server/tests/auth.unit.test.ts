import { describe, it, expect, vi } from 'vitest';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { env } from '../src/env.js';
import {
  createUserSchema,
  loginSchema,
  registerSchema,
  updateUserSchema,
} from '../src/modules/auth/auth.schemas.js';
import {
  hashPassword,
  signSession,
  toPublicUser,
  verifySession,
} from '../src/modules/auth/auth.service.js';
import { requireRole } from '../src/middleware/auth.js';

const valid = { name: 'Asha Rao', email: 'asha@example.com', password: 'Passw0rd1' };

describe('registerSchema (F1)', () => {
  it('accepts valid input and normalizes name and email', () => {
    const result = registerSchema.parse({
      name: '  Asha Rao  ',
      email: '  Asha@Example.COM ',
      password: 'Passw0rd1',
    });
    expect(result).toEqual({ name: 'Asha Rao', email: 'asha@example.com', password: 'Passw0rd1' });
  });

  it('strips unknown fields such as role', () => {
    const result = registerSchema.parse({ ...valid, role: 'ADMIN' });
    expect(result).not.toHaveProperty('role');
  });

  it.each([
    ['a name shorter than 2 characters', { ...valid, name: 'A' }, 'name'],
    ['an invalid email', { ...valid, email: 'not-an-email' }, 'email'],
    ['a password shorter than 8 characters', { ...valid, password: 'Ab1' }, 'password'],
    ['a password without a number', { ...valid, password: 'abcdefgh' }, 'password'],
    ['a password without a letter', { ...valid, password: '12345678' }, 'password'],
    ['a password longer than 128 characters', { ...valid, password: 'a1'.repeat(65) }, 'password'],
  ])('rejects %s', (_label, input, field) => {
    const result = registerSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === field)).toBe(true);
    }
  });
});

describe('loginSchema', () => {
  it('trims and lowercases the email', () => {
    const result = loginSchema.parse({ email: '  USER@Example.com ', password: 'x' });
    expect(result.email).toBe('user@example.com');
  });

  it('rejects an empty password', () => {
    expect(loginSchema.safeParse({ email: 'a@b.com', password: '' }).success).toBe(false);
  });
});

describe('createUserSchema (F5)', () => {
  it('accepts a valid staff account', () => {
    expect(createUserSchema.parse({ ...valid, role: 'STAFF' }).role).toBe('STAFF');
  });

  it('rejects an unknown role', () => {
    expect(createUserSchema.safeParse({ ...valid, role: 'SUPERUSER' }).success).toBe(false);
  });
});

describe('updateUserSchema (F5)', () => {
  it('rejects an empty update', () => {
    expect(updateUserSchema.safeParse({}).success).toBe(false);
  });

  it('accepts a role-only update', () => {
    expect(updateUserSchema.safeParse({ role: 'STAFF' }).success).toBe(true);
  });

  it('accepts an isActive-only update', () => {
    expect(updateUserSchema.safeParse({ isActive: false }).success).toBe(true);
  });

  it('rejects an invalid role', () => {
    expect(updateUserSchema.safeParse({ role: 'OWNER' }).success).toBe(false);
  });
});

describe('password hashing (S3)', () => {
  it('produces a salted argon2id hash that verifies the correct password', async () => {
    const h1 = await hashPassword('Passw0rd1');
    const h2 = await hashPassword('Passw0rd1');
    expect(h1.startsWith('$argon2id$')).toBe(true);
    expect(h1).not.toBe(h2);
    expect(await argon2.verify(h1, 'Passw0rd1')).toBe(true);
  });

  it('does not verify a wrong password', async () => {
    const hash = await hashPassword('Passw0rd1');
    expect(await argon2.verify(hash, 'Passw0rd2')).toBe(false);
  });
});

describe('session tokens (S1)', () => {
  it('round-trips a user id', () => {
    expect(verifySession(signSession('user-123'))).toBe('user-123');
  });

  it.each([
    ['a garbage string', () => 'not-a-token'],
    ['a token signed with a different secret', () => jwt.sign({ sub: 'user-123' }, 'another-secret-another-secret-123456')],
    ['an expired token', () => jwt.sign({ sub: 'user-123' }, env.JWT_SECRET, { expiresIn: -10 })],
  ])('rejects %s', (_label, makeToken) => {
    expect(verifySession(makeToken())).toBeNull();
  });
});

describe('toPublicUser', () => {
  it('never exposes the password hash', () => {
    const full = {
      id: '1',
      email: 'a@b.com',
      name: 'A',
      role: 'CUSTOMER',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      passwordHash: 'secret',
    };
    const pub = toPublicUser(full as never);
    expect(pub).not.toHaveProperty('passwordHash');
    expect(Object.keys(pub).sort()).toEqual(['createdAt', 'email', 'id', 'isActive', 'name', 'role']);
  });
});

describe('requireRole middleware (S2)', () => {
  const callWith = (user: { role: string } | undefined, ...allowed: Array<'CUSTOMER' | 'STAFF' | 'ADMIN'>) => {
    const next = vi.fn();
    requireRole(...allowed)({ user } as never, {} as never, next);
    return next;
  };

  it('lets an allowed role through', () => {
    const next = callWith({ role: 'ADMIN' }, 'ADMIN');
    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith();
  });

  it('rejects a role that is not allowed with 403', () => {
    const next = callWith({ role: 'CUSTOMER' }, 'ADMIN');
    expect(next.mock.calls[0]?.[0]).toMatchObject({ status: 403 });
  });

  it('rejects a missing user with 401', () => {
    const next = callWith(undefined, 'ADMIN');
    expect(next.mock.calls[0]?.[0]).toMatchObject({ status: 401 });
  });
});