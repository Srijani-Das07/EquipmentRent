import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PolicyService, PolicyValidationError, type PolicyAuditEntry } from '../src/config/policy.service.js';
import type { PolicyConfig } from '../src/config/policy.schema.js';

const baseConfig = (): PolicyConfig => ({
  schema_version: 1,
  defaults: {
    maintenance_interval_rentals: 10,
    damage_penalty_pct: { minor: 15, major: 50, lost: 100 },
    late_fee_per_day: 100,
    late_cancellation_fee_pct: 20,
  },
  system: { data_retention_days: 365, payment_hold_minutes: 15, pickup_time: '09:00', timezone: 'Asia/Kolkata' },
  overrides: {
    categories: {
      electronics: { maintenance_interval_rentals: 8, damage_penalty_pct: { minor: 20, major: 60 } },
    },
    equipment: {
      'cam-1': { maintenance_interval_rentals: 5, late_fee_per_day: 250 },
    },
  },
});

let dir: string;
let file: string;
let versions: string;
let audits: PolicyAuditEntry[];
let svc: PolicyService;

async function writeConfig(cfg: unknown) {
  await fs.writeFile(file, JSON.stringify(cfg, null, 2));
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'policy-'));
  file = path.join(dir, 'equipment_policy_config.json');
  versions = path.join(dir, 'versions');
  audits = [];
  await writeConfig(baseConfig());
  svc = new PolicyService({
    filePath: file,
    versionsDir: versions,
    pollIntervalMs: 50,
    auditSink: async (e) => {
      audits.push(e);
    },
  });
  await svc.start();
});

afterEach(async () => {
  svc.stop();
  await fs.rm(dir, { recursive: true, force: true });
});

describe('getPolicy resolution (F26, F28)', () => {
  it('returns defaults when no override exists', () => {
    const p = svc.getPolicy({ categorySlug: 'tools', equipmentId: 'x' });
    expect(p).toEqual({
      maintenanceIntervalRentals: 10,
      damagePenaltyPct: { minor: 15, major: 50, lost: 100 },
      lateFeePerDay: 100,
      lateCancellationFeePct: 20,
    });
  });

  it('applies a category override and keeps other values at default', () => {
    const p = svc.getPolicy({ categorySlug: 'electronics' });
    expect(p.maintenanceIntervalRentals).toBe(8);
    expect(p.damagePenaltyPct).toEqual({ minor: 20, major: 60, lost: 100 });
    expect(p.lateFeePerDay).toBe(100);
  });

  it('lets an equipment override beat a category override', () => {
    const p = svc.getPolicy({ categorySlug: 'electronics', equipmentId: 'cam-1' });
    expect(p.maintenanceIntervalRentals).toBe(5);
    expect(p.lateFeePerDay).toBe(250);
    expect(p.damagePenaltyPct.minor).toBe(20); // still from the category
  });

  it('treats an explicit 0 override as a real value, not as missing', async () => {
    const cfg = baseConfig();
    cfg.overrides.equipment['free-1'] = { late_fee_per_day: 0 };
    await svc.update(cfg, 'admin-1');
    expect(svc.getPolicy({ equipmentId: 'free-1' }).lateFeePerDay).toBe(0);
  });

  it('always reports lost = 100', () => {
    expect(svc.getPolicy().damagePenaltyPct.lost).toBe(100);
  });
});

describe('validation (S4)', () => {
  const rejects = async (mutate: (c: any) => void, pathFragment: string) => {
    const cfg: any = baseConfig();
    mutate(cfg);
    const err = await svc.update(cfg, 'admin-1').catch((e) => e);
    expect(err).toBeInstanceOf(PolicyValidationError);
    expect((err as PolicyValidationError).issues.some((i) => i.path.includes(pathFragment))).toBe(true);
  };

  it('rejects percentages outside 0-100', () =>
    rejects((c) => (c.defaults.late_cancellation_fee_pct = 120), 'late_cancellation_fee_pct'));
  it('rejects negative percentages', () =>
    rejects((c) => (c.defaults.damage_penalty_pct.minor = -5), 'minor'));
  it('rejects negative fees', () => rejects((c) => (c.defaults.late_fee_per_day = -1), 'late_fee_per_day'));
  it('rejects a non-integer or zero maintenance interval', async () => {
    await rejects((c) => (c.defaults.maintenance_interval_rentals = 0), 'maintenance_interval_rentals');
    await rejects((c) => (c.defaults.maintenance_interval_rentals = 2.5), 'maintenance_interval_rentals');
  });
  it('rejects changing the lost penalty from 100', () =>
    rejects((c) => (c.defaults.damage_penalty_pct.lost = 80), 'lost'));
  it('rejects minor greater than major', () =>
    rejects((c) => (c.defaults.damage_penalty_pct.minor = 70), 'damage_penalty_pct'));
  it('rejects an override that makes minor exceed the inherited major', () =>
    rejects((c) => (c.overrides.categories.tools = { damage_penalty_pct: { minor: 90 } }), 'tools'));
  it('rejects unknown keys', () => rejects((c) => (c.defaults.surprise = 1), 'defaults'));
  it('rejects an invalid pickup time and timezone', async () => {
    await rejects((c) => (c.system.pickup_time = '25:00'), 'pickup_time');
    await rejects((c) => (c.system.timezone = 'Mars/Base'), 'timezone');
  });

  it('does not change the live config or write files when validation fails', async () => {
    const cfg: any = baseConfig();
    cfg.defaults.late_fee_per_day = -1;
    await svc.update(cfg, 'admin-1').catch(() => undefined);
    expect(svc.getPolicy().lateFeePerDay).toBe(100);
    expect(await svc.listVersions()).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });
});

describe('update (F30, S5, 5.2)', () => {
  it('applies the change, persists it, backs up the old file and audits who changed what', async () => {
    const cfg = baseConfig();
    cfg.defaults.late_fee_per_day = 150;
    const result = await svc.update(cfg, 'admin-7');

    expect(result.defaults.late_fee_per_day).toBe(150);
    expect(svc.getPolicy().lateFeePerDay).toBe(150);

    const onDisk = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(onDisk.defaults.late_fee_per_day).toBe(150);

    const versions = await svc.listVersions();
    expect(versions).toHaveLength(1);
    const backup = JSON.parse(await fs.readFile(path.join(dir, 'versions', versions[0]!), 'utf8'));
    expect(backup.defaults.late_fee_per_day).toBe(100);

    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorId: 'admin-7',
      action: 'UPDATE',
      changes: [{ path: 'defaults.late_fee_per_day', from: 100, to: 150 }],
    });
  });

  it('is a no-op (no backup, no audit) when nothing changed', async () => {
    await svc.update(baseConfig(), 'admin-1');
    expect(await svc.listVersions()).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });

  it('serialises concurrent saves so none are lost or corrupt the file', async () => {
    const make = (fee: number) => {
      const c = baseConfig();
      c.defaults.late_fee_per_day = fee;
      return c;
    };
    await Promise.all([svc.update(make(111), 'a'), svc.update(make(222), 'b'), svc.update(make(333), 'c')]);
    expect(svc.getPolicy().lateFeePerDay).toBe(333);
    expect(JSON.parse(await fs.readFile(file, 'utf8')).defaults.late_fee_per_day).toBe(333);
    expect(audits).toHaveLength(3);
    expect(await svc.listVersions()).toHaveLength(3);
  });

  it('still applies the change if the audit sink throws', async () => {
    svc.stop();
    svc = new PolicyService({
      filePath: file,
      versionsDir: versions,
      auditSink: async () => {
        throw new Error('db down');
      },
    });
    await svc.start();
    const cfg = baseConfig();
    cfg.defaults.late_fee_per_day = 175;
    await svc.update(cfg, 'admin-1');
    expect(svc.getPolicy().lateFeePerDay).toBe(175);
  });

  it('restores a previous version and records a RESTORE audit', async () => {
    const cfg = baseConfig();
    cfg.defaults.late_fee_per_day = 150;
    await svc.update(cfg, 'admin-1');
    const [backup] = await svc.listVersions();

    await svc.restoreVersion(backup!, 'admin-2');
    expect(svc.getPolicy().lateFeePerDay).toBe(100);
    expect(audits.at(-1)).toMatchObject({ action: 'RESTORE', actorId: 'admin-2' });
  });

  it('refuses path traversal in restore', async () => {
    await expect(svc.restoreVersion('../equipment_policy_config.json', 'admin-1')).rejects.toThrow();
  });
});

describe('hot reload (P4)', () => {
  it('picks up a valid hand edit within the poll interval, without a restart', async () => {
    const cfg = baseConfig();
    cfg.defaults.late_fee_per_day = 300;
    await writeConfig(cfg);
    await waitFor(() => svc.getPolicy().lateFeePerDay === 300);
    expect(svc.getPolicy().lateFeePerDay).toBe(300);
  });

  it('keeps the last valid config when the file is edited into something invalid', async () => {
    const bad: any = baseConfig();
    bad.defaults.late_fee_per_day = -999;
    await writeConfig(bad);
    await sleep(300);
    expect(svc.getPolicy().lateFeePerDay).toBe(100);

    await fs.writeFile(file, '{ not json');
    await sleep(300);
    expect(svc.getPolicy().lateFeePerDay).toBe(100);
  });
});

describe('startup', () => {
  it('refuses to start on an invalid config file', async () => {
    const bad: any = baseConfig();
    bad.defaults.damage_penalty_pct.major = 500;
    await writeConfig(bad);
    const s = new PolicyService({ filePath: file, versionsDir: versions });
    await expect(s.start()).rejects.toBeInstanceOf(PolicyValidationError);
  });

  it('throws if used before start', () => {
    const s = new PolicyService({ filePath: file, versionsDir: versions });
    expect(() => s.getPolicy()).toThrow(/not started/);
  });
});

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
async function waitFor(cond: () => boolean, timeoutMs = 4000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for condition');
    await sleep(25);
  }
}
