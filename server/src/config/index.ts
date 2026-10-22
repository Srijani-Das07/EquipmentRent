import { env } from '../env.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/db.js';
import { PolicyService } from './policy.service.js';

/** App-wide policy service. Audit entries are persisted to the ConfigAuditLog table (S5). */
export const policy = new PolicyService({
  filePath: env.policyConfigPath,
  versionsDir: env.policyVersionsDir,
  pollIntervalMs: env.POLICY_CONFIG_POLL_MS,
  logger,
  auditSink: async (entry) => {
    await prisma.configAuditLog.create({
      data: {
        actorId: entry.actorId,
        action: entry.action,
        changes: entry.changes as object[],
        before: entry.before as object,
        after: entry.after as object,
        versionFile: entry.versionFile,
      },
    });
  },
});
