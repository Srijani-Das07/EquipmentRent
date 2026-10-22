import { promises as fs, watchFile, unwatchFile } from 'node:fs';
import path from 'node:path';
import {
  policyConfigSchema,
  type PolicyConfig,
  type PolicyOverride,
  type ResolvedPolicy,
  type SystemSettings,
} from './policy.schema.js';

export interface PolicyLogger {
  info: (obj: object | string, msg?: string) => void;
  warn: (obj: object | string, msg?: string) => void;
  error: (obj: object | string, msg?: string) => void;
}

export interface PolicyAuditEntry {
  actorId: string;
  action: 'UPDATE' | 'RESTORE';
  changes: ConfigChange[];
  before: PolicyConfig;
  after: PolicyConfig;
  versionFile: string | null;
}

export type PolicyAuditSink = (entry: PolicyAuditEntry) => Promise<void>;

export interface ConfigChange {
  path: string;
  from: unknown;
  to: unknown;
}

export interface PolicyServiceOptions {
  filePath: string;
  versionsDir: string;
  pollIntervalMs?: number; // P4: must be < 5000
  logger?: PolicyLogger;
  auditSink?: PolicyAuditSink;
}

export interface PolicyLookup {
  equipmentId?: string;
  categorySlug?: string;
}

export class PolicyValidationError extends Error {
  constructor(public readonly issues: Array<{ path: string; message: string }>) {
    super('Policy configuration is invalid');
    this.name = 'PolicyValidationError';
  }
}

const noopLogger: PolicyLogger = { info() {}, warn() {}, error() {} };

/**
 * Single source of truth for business rules (SRS F23-F30, P4, S4, S5, 5.2).
 *
 * - Loads and validates the JSON file; the app never runs on an invalid config.
 * - Hot reload: the file is polled, so edits take effect without a restart (P4).
 *   If a hand edit is invalid, the last good config stays active and an error is logged.
 * - Admin writes are validated, backed up, written atomically and audited.
 */
export class PolicyService {
  private config: PolicyConfig | null = null;
  private lastMtimeMs = 0;
  private writeQueue: Promise<unknown> = Promise.resolve();
  private readonly pollMs: number;
  private readonly log: PolicyLogger;

  constructor(private readonly opts: PolicyServiceOptions) {
    this.pollMs = opts.pollIntervalMs ?? 2000;
    this.log = opts.logger ?? noopLogger;
  }

  /** Load the file (throws if invalid at startup) and start watching for changes. */
  async start(): Promise<void> {
    await this.reloadFromDisk(true);
    watchFile(this.opts.filePath, { interval: this.pollMs, persistent: false }, () => {
      void this.reloadFromDisk(false);
    });
  }

  stop(): void {
    unwatchFile(this.opts.filePath);
  }

  /** Current validated config (deep copy, safe to mutate). */
  getConfig(): PolicyConfig {
    return structuredClone(this.requireConfig());
  }

  getSystem(): SystemSettings {
    return { ...this.requireConfig().system };
  }

  /** Resolve rules for an item: equipment override > category override > defaults (F26, F28). */
  getPolicy(lookup: PolicyLookup = {}): ResolvedPolicy {
    const cfg = this.requireConfig();
    const d = cfg.defaults;
    const cat: PolicyOverride | undefined = lookup.categorySlug
      ? cfg.overrides.categories[lookup.categorySlug]
      : undefined;
    const eq: PolicyOverride | undefined = lookup.equipmentId
      ? cfg.overrides.equipment[lookup.equipmentId]
      : undefined;

    const pick = <T>(sel: (o: PolicyOverride) => T | undefined, base: T): T =>
      (eq ? sel(eq) : undefined) ?? (cat ? sel(cat) : undefined) ?? base;

    return {
      maintenanceIntervalRentals: pick((o) => o.maintenance_interval_rentals, d.maintenance_interval_rentals),
      damagePenaltyPct: {
        minor: pick((o) => o.damage_penalty_pct?.minor, d.damage_penalty_pct.minor),
        major: pick((o) => o.damage_penalty_pct?.major, d.damage_penalty_pct.major),
        lost: 100,
      },
      lateFeePerDay: pick((o) => o.late_fee_per_day, d.late_fee_per_day),
      lateCancellationFeePct: pick((o) => o.late_cancellation_fee_pct, d.late_cancellation_fee_pct),
    };
  }

  /**
   * Validate and apply a new config on behalf of an admin (F30, S4, S5, 5.2).
   * Order: validate -> back up the current file -> atomic write -> swap in memory -> audit.
   */
  update(input: unknown, actorId: string): Promise<PolicyConfig> {
    return this.enqueue(async () => {
      const next = this.validate(input);
      const before = this.requireConfig();
      const changes = diffConfigs(before, next);
      if (changes.length === 0) return structuredClone(before);
      const versionFile = await this.backupCurrent();
      await this.atomicWrite(next);
      this.config = next;
      await this.refreshMtime();
      await this.audit({ actorId, action: 'UPDATE', changes, before, after: next, versionFile });
      this.log.info({ actorId, changes: changes.length }, 'policy config updated');
      return structuredClone(next);
    });
  }

  /** Newest first. */
  async listVersions(): Promise<string[]> {
    const names = await fs.readdir(this.opts.versionsDir).catch(() => [] as string[]);
    return names.filter((n) => n.endsWith('.json')).sort().reverse();
  }

  /** Restore a previous backup (5.2). The current file is itself backed up first. */
  restoreVersion(fileName: string, actorId: string): Promise<PolicyConfig> {
    return this.enqueue(async () => {
      if (fileName !== path.basename(fileName) || !fileName.endsWith('.json')) {
        throw new Error('Invalid version file name');
      }
      const raw = await fs.readFile(path.join(this.opts.versionsDir, fileName), 'utf8');
      const restored = this.validate(JSON.parse(raw));
      const before = this.requireConfig();
      const changes = diffConfigs(before, restored);
      const versionFile = await this.backupCurrent();
      await this.atomicWrite(restored);
      this.config = restored;
      await this.refreshMtime();
      await this.audit({ actorId, action: 'RESTORE', changes, before, after: restored, versionFile });
      this.log.info({ actorId, fileName }, 'policy config restored');
      return structuredClone(restored);
    });
  }

  // ---- internals -----------------------------------------------------------

  private requireConfig(): PolicyConfig {
    if (!this.config) throw new Error('PolicyService not started');
    return this.config;
  }

  private validate(input: unknown): PolicyConfig {
    const result = policyConfigSchema.safeParse(input);
    if (!result.success) {
      throw new PolicyValidationError(
        result.error.issues.map((i) => ({ path: i.path.join('.') || '(root)', message: i.message })),
      );
    }
    return result.data;
  }

  private async reloadFromDisk(strict: boolean): Promise<void> {
    try {
      const raw = await fs.readFile(this.opts.filePath, 'utf8');
      const parsed = this.validate(JSON.parse(raw));
      this.config = parsed;
      await this.refreshMtime();
      this.log.info({ file: this.opts.filePath }, 'policy config loaded');
    } catch (err) {
      if (strict) throw err; // refuse to start on a broken config
      this.log.error({ err }, 'policy config reload failed; keeping last valid config');
    }
  }

  private async refreshMtime(): Promise<void> {
    const stat = await fs.stat(this.opts.filePath);
    this.lastMtimeMs = stat.mtimeMs;
  }

  private async backupCurrent(): Promise<string> {
    await fs.mkdir(this.opts.versionsDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    let name = `policy-${stamp}.json`;
    let n = 1;
    while (await exists(path.join(this.opts.versionsDir, name))) {
      name = `policy-${stamp}-${n++}.json`;
    }
    await fs.copyFile(this.opts.filePath, path.join(this.opts.versionsDir, name));
    return name;
  }

  private async atomicWrite(cfg: PolicyConfig): Promise<void> {
    const tmp = `${this.opts.filePath}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
    await fs.rename(tmp, this.opts.filePath);
  }

  private async audit(entry: PolicyAuditEntry): Promise<void> {
    if (!this.opts.auditSink) return;
    try {
      await this.opts.auditSink(entry);
    } catch (err) {
      // The change is already applied and backed up; never lose it because auditing failed.
      this.log.error({ err, entry: { ...entry, before: undefined, after: undefined } }, 'policy audit write failed');
    }
  }

  /** Serialise writes so concurrent admin saves cannot interleave. */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.writeQueue.then(task, task);
    this.writeQueue = run.catch(() => undefined);
    return run;
  }
}

async function exists(p: string): Promise<boolean> {
  return fs.access(p).then(() => true, () => false);
}

/** Flat, human-readable diff between two configs (used for the audit trail). */
export function diffConfigs(a: PolicyConfig, b: PolicyConfig): ConfigChange[] {
  const fa = flatten(a);
  const fb = flatten(b);
  const keys = new Set([...Object.keys(fa), ...Object.keys(fb)]);
  const changes: ConfigChange[] = [];
  for (const k of [...keys].sort()) {
    if (fa[k] !== fb[k]) changes.push({ path: k, from: fa[k] ?? null, to: fb[k] ?? null });
  }
  return changes;
}

function flatten(obj: unknown, prefix = '', out: Record<string, unknown> = {}): Record<string, unknown> {
  if (obj !== null && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      flatten(v, prefix ? `${prefix}.${k}` : k, out);
    }
  } else {
    out[prefix] = obj;
  }
  return out;
}
