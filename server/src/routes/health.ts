import { Router } from 'express';
import type { PolicyService } from '../config/policy.service.js';

export interface HealthDeps {
  /** Resolves if the database answers; rejects otherwise. */
  pingDb: () => Promise<void>;
  policy: PolicyService;
}

export function healthRouter({ pingDb, policy }: HealthDeps): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    let database: 'up' | 'down' = 'up';
    try {
      await pingDb();
    } catch {
      database = 'down';
    }

    let policyStatus: 'loaded' | 'unavailable' = 'loaded';
    try {
      policy.getConfig();
    } catch {
      policyStatus = 'unavailable';
    }

    const ok = database === 'up' && policyStatus === 'loaded';
    res.status(ok ? 200 : 503).json({
      status: ok ? 'ok' : 'degraded',
      database,
      policyConfig: policyStatus,
      uptimeSeconds: Math.round(process.uptime()),
      time: new Date().toISOString(),
    });
  });

  return router;
}
