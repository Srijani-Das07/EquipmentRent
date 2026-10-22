import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { PolicyService } from '../src/config/policy.service.js';

let dir: string;
let policy: PolicyService;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'app-'));
  const file = path.join(dir, 'policy.json');
  await fs.copyFile(path.resolve('config/equipment_policy_config.json'), file);
  policy = new PolicyService({ filePath: file, versionsDir: path.join(dir, 'versions') });
  await policy.start();
});

afterAll(async () => {
  policy.stop();
  await fs.rm(dir, { recursive: true, force: true });
});

describe('GET /api/health', () => {
  it('reports ok when the database and policy config are available', async () => {
    const app = createApp({ pingDb: async () => {}, policy });
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'up', policyConfig: 'loaded' });
  });

  it('reports degraded with 503 when the database is down', async () => {
    const app = createApp({
      pingDb: async () => {
        throw new Error('connection refused');
      },
      policy,
    });
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: 'degraded', database: 'down' });
  });
});

describe('error handling and security headers', () => {
  const app = () => createApp({ pingDb: async () => {}, policy });

  it('returns a JSON 404 for unknown routes', async () => {
    const res = await request(app()).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns a JSON 400 for malformed JSON bodies', async () => {
    const res = await request(app()).post('/api/anything').set('Content-Type', 'application/json').send('{bad');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_JSON');
  });

  it('sets helmet headers and hides x-powered-by', async () => {
    const res = await request(app()).get('/api/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
