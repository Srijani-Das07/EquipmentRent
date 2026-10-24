import { randomInt } from 'node:crypto';

// No 0/O or 1/I so references are easy to read out loud.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Human-friendly unique-looking reference such as BK-20261103-7K2QX. */
export function makeReference(prefix: string, now: Date = new Date(), length = 5): string {
  const day = now.toISOString().slice(0, 10).replaceAll('-', '');
  let suffix = '';
  for (let i = 0; i < length; i++) suffix += ALPHABET[randomInt(ALPHABET.length)];
  return `${prefix}-${day}-${suffix}`;
}
