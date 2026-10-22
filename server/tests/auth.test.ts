import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import argon2 from 'argon2';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/db.js';
import type { PolicyService } from '../src/config/policy.service.js';

const app = createApp({ pingDb: async () => {}, policy: {} as PolicyService });

const PASSWORD = 'Test@12345';
const email = (n: string) => `${n}@test.local`;

async function seedUser(name: string, role: 'CUSTOMER' | 'STAFF' | 'ADMIN') {
  return prisma.user.create({
    data: {
      name,
      email: email(name),
      role,
      passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
    },
  });
}

const cleanup = () => prisma.user.deleteMany({ where: { email: { endsWith: '@test.local' } } });

async function loginAs(name: string) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email: email(name), password: PASSWORD });
  expect(res.status).toBe(200);
  return agent;
}

beforeAll(async () => {
  await cleanup();
  await seedUser('t-admin', 'ADMIN');
  await seedUser('t-admin2', 'ADMIN');
  await seedUser('t-staff', 'STAFF');
  await seedUser('t-customer', 'CUSTOMER');
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('F1 registration', () => {
  it('registers a customer, ignores a requested role, sets an httpOnly cookie, hides the hash', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'New Person', email: email('new-person'), password: PASSWORD, role: 'ADMIN' });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('CUSTOMER');
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(res.headers['set-cookie']?.[0]).toMatch(/er_session=.*HttpOnly/);
  });

  it('stores the password hashed with argon2id (S3)', async () => {
    const row = await prisma.user.findUniqueOrThrow({ where: { email: email('new-person') } });
    expect(row.passwordHash).not.toBe(PASSWORD);
    expect(row.passwordHash.startsWith('$argon2id$')).toBe(true);
  });

  it('lowercases the email', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Mixed Case', email: 'Mixed.Case@Test.Local', password: PASSWORD });
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe('mixed.case@test.local');
  });

  it('rejects a duplicate email with 409', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Dup', email: email('t-customer'), password: PASSWORD });
    expect(res.status).toBe(409);
  });

  it('rejects weak passwords with 400', async () => {
    for (const password of ['abc', 'abcdefgh', '12345678']) {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ name: 'Weak', email: email('weak'), password });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });
});

describe('login', () => {
  it('logs in with correct credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: email('t-customer'), password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('CUSTOMER');
  });

  it('gives the same generic error for a wrong password and an unknown email', async () => {
    const wrong = await request(app)
      .post('/api/auth/login')
      .send({ email: email('t-customer'), password: 'Wrong@12345' });
    const unknown = await request(app)
      .post('/api/auth/login')
      .send({ email: email('nobody-here'), password: PASSWORD });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.message).toBe('Invalid email or password');
    expect(unknown.body.error.message).toBe('Invalid email or password');
  });
});

describe('S1 sessions', () => {
  it('requires login for /me', async () => {
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
  });

  it('returns the user for /me, and logout ends the session', async () => {
    const agent = await loginAs('t-customer');
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(email('t-customer'));
    await agent.post('/api/auth/logout');
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });
});

describe('S2 role-based access control', () => {
  it('blocks guests (401), customers (403) and staff (403) from admin routes', async () => {
    expect((await request(app).get('/api/users')).status).toBe(401);
    expect((await (await loginAs('t-customer')).get('/api/users')).status).toBe(403);
    expect((await (await loginAs('t-staff')).get('/api/users')).status).toBe(403);
  });

  it('lets an admin list users without exposing password hashes', async () => {
    const res = await (await loginAs('t-admin')).get('/api/users');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.users)).toBe(true);
    expect(res.body.users[0].passwordHash).toBeUndefined();
  });
});

describe('F5 admin user management', () => {
  it('creates a staff account that can log in', async () => {
    const admin = await loginAs('t-admin');
    const res = await admin
      .post('/api/users')
      .send({ name: 'Created Staff', email: email('created-staff'), password: PASSWORD, role: 'STAFF' });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('STAFF');
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: email('created-staff'), password: PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.user.role).toBe('STAFF');
  });

  it('changes a role', async () => {
    const target = await seedUser('t-target', 'CUSTOMER');
    const admin = await loginAs('t-admin');
    const res = await admin.patch(`/api/users/${target.id}`).send({ role: 'STAFF' });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('STAFF');
  });

  it('rejects an empty update with 400', async () => {
    const target = await prisma.user.findUniqueOrThrow({ where: { email: email('t-customer') } });
    const admin = await loginAs('t-admin');
    expect((await admin.patch(`/api/users/${target.id}`).send({})).status).toBe(400);
  });

  it('stops an admin from demoting or deactivating themselves', async () => {
    const self = await prisma.user.findUniqueOrThrow({ where: { email: email('t-admin') } });
    const admin = await loginAs('t-admin');
    expect((await admin.patch(`/api/users/${self.id}`).send({ role: 'CUSTOMER' })).status).toBe(409);
    expect((await admin.patch(`/api/users/${self.id}`).send({ isActive: false })).status).toBe(409);
  });

  it('blocks a deactivated user from logging in and kills their existing session', async () => {
    const victim = await seedUser('t-victim', 'CUSTOMER');
    const victimAgent = await loginAs('t-victim');
    const admin = await loginAs('t-admin');

    const res = await admin.patch(`/api/users/${victim.id}`).send({ isActive: false });
    expect(res.status).toBe(200);

    expect((await victimAgent.get('/api/auth/me')).status).toBe(401);
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: email('t-victim'), password: PASSWORD });
    expect(login.status).toBe(403);
  });
});