import type { Server } from 'node:http';
import { env } from './env.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/db.js';
import { policy } from './config/index.js';
import { createApp } from './app.js';
import { expireStaleHolds } from './modules/bookings/holds.js';

async function main() {
  await policy.start(); // throws on an invalid config: we refuse to run on bad business rules
  await prisma.$connect();

  const app = createApp({
    pingDb: async () => {
      await prisma.$queryRaw`SELECT 1`;
    },
    policy,
  });
  // Release unpaid bookings whose payment hold has run out.
  const holdSweeper = setInterval(() => {
    expireStaleHolds().catch((err) => logger.error({ err }, 'hold sweep failed'));
  }, 60_000);
  holdSweeper.unref();

  const server: Server = app.listen(env.PORT, () => {
    logger.info(`API listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
  });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    clearInterval(holdSweeper);
    policy.stop();
    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandled rejection'));
}

main().catch((err) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
