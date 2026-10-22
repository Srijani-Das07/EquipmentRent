// One-time database setup: creates the init migration from schema.prisma, appends the
// custom constraints (overlap exclusion etc.), applies it, and generates the client.
// Safe to re-run: it does nothing if the init migration already exists.
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = join(root, 'prisma', 'migrations');
const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' });

const hasInit =
  existsSync(migrationsDir) && readdirSync(migrationsDir).some((d) => d.endsWith('_init'));

if (hasInit) {
  console.log('Init migration already exists; applying pending migrations.');
  run('npx prisma migrate deploy');
} else {
  run('npx prisma migrate dev --name init --create-only --skip-seed');
  const dir = readdirSync(migrationsDir).find((d) => d.endsWith('_init'));
  if (!dir) throw new Error('Init migration was not created.');
  const sql = readFileSync(join(root, 'prisma', 'sql', 'booking_constraints.sql'), 'utf8');
  appendFileSync(join(migrationsDir, dir, 'migration.sql'), sql);
  console.log(`Appended custom constraints to ${dir}/migration.sql`);
  run('npx prisma migrate deploy');
}
run('npx prisma generate');
console.log('Database ready.');