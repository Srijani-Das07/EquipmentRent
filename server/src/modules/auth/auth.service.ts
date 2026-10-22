import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import type { Response } from 'express';
import { Prisma, type Role, type User } from '@prisma/client';
import { prisma } from '../../lib/db.js';
import { env } from '../../env.js';
import { AppError } from '../../lib/errors.js';

export const SESSION_COOKIE = 'er_session';
export const SESSION_HOURS = 8;

export type PublicUser = Pick<User, 'id' | 'email' | 'name' | 'role' | 'isActive' | 'createdAt'>;

export const toPublicUser = (u: User): PublicUser => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  isActive: u.isActive,
  createdAt: u.createdAt,
});

export const hashPassword = (plain: string): Promise<string> =>
  argon2.hash(plain, { type: argon2.argon2id });

// Used so a login for an unknown email takes about as long as one for a real email.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hashPassword('not-a-real-password-1'));

export function signSession(userId: string): string {
  return jwt.sign({ sub: userId }, env.JWT_SECRET, { expiresIn: SESSION_HOURS * 3600 });
}

export function verifySession(token: string): string | null {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET);
    return typeof payload === 'object' && typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

const cookieBase = { httpOnly: true, sameSite: 'lax', secure: env.isProd, path: '/' } as const;

export function setSessionCookie(res: Response, userId: string): void {
  res.cookie(SESSION_COOKIE, signSession(userId), { ...cookieBase, maxAge: SESSION_HOURS * 3600 * 1000 });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, cookieBase);
}

export async function createUser(input: {
  name: string;
  email: string;
  password: string;
  role: Role;
}): Promise<User> {
  const passwordHash = await hashPassword(input.password);
  try {
    return await prisma.user.create({
      data: { name: input.name, email: input.email, passwordHash, role: input.role },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw AppError.conflict('An account with this email already exists');
    }
    throw err;
  }
}

/** Verifies credentials. Wrong email and wrong password give the same error. */
export async function authenticateCredentials(email: string, password: string): Promise<User> {
  const user = await prisma.user.findUnique({ where: { email } });
  const ok = await argon2.verify(user?.passwordHash ?? (await getDummyHash()), password);
  if (!user || !ok) throw AppError.unauthorized('Invalid email or password');
  if (!user.isActive) {
    throw AppError.forbidden('This account has been deactivated. Contact an administrator.');
  }
  return user;
}