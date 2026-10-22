import pino from 'pino';
import { env } from '../env.js';

export const logger = pino({
  level: env.isTest ? 'silent' : env.LOG_LEVEL,
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.passwordHash', '*.cardNumber', '*.cvv'],
    censor: '[redacted]',
  },
  ...(env.isProd || env.isTest
    ? {}
    : { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } } }),
});
