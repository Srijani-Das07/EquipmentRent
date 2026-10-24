# Equipment Rental & Maintenance Management System

Node + Express + TypeScript + Prisma + PostgreSQL on the server, React + Vite + Tailwind on the client.

## First-time setup

Requires Node 20+ and Docker Desktop.

```bash
npm install                                   # installs both apps and generates the Prisma client
cp server/.env.example server/.env            # Windows (cmd): copy server\.env.example server\.env
npm run db:up                                 # starts PostgreSQL in Docker
npm run db:init                               # creates tables + the no-double-booking constraint
npm run db:seed                               # sample categories, equipment, units, 3 demo users
npm run dev                                   # API on :4000, web app on :5173
```

Open http://localhost:5173. The home page shows live API / database / policy-config status.

Demo logins (development only): admin@rental.local / Admin@12345, staff@rental.local / Staff@12345,
customer@rental.local / Customer@12345.

## Useful commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Run API and web app together |
| `npm test` | Run server tests (policy config, API skeleton) |
| `npm run typecheck` | Type-check both apps |
| `npm run build` | Production build of both apps |
| `npm run db:reset` | Drop and recreate the database from migrations, then re-seed |

## Business rules live in `server/config/equipment_policy_config.json`

Defaults plus category and per-item overrides (item > category > default). Edits are validated, picked up
within ~2 seconds without a restart, and every save made through the app is backed up to
`server/config/versions/` and recorded in the `ConfigAuditLog` table. Money values in this file are in rupees.

## Conventions

- Money is stored as integer paise; timestamps are UTC (`timestamptz`).
- Category overrides are keyed by category **slug**, item overrides by equipment **id**.
- "Booked" is derived from bookings, not stored. Unit status is only AVAILABLE / UNDER_MAINTENANCE / RETIRED.
- The `booking_no_overlap` database constraint makes double-booking a unit impossible, even under concurrency.


- npm install jsonwebtoken cookie-parser -w server
- npm install -D @types/jsonwebtoken @types/cookie-parser -w server

For mod 2:

Run

Unit tests, from the server folder: npx vitest run tests/inventory.unit.test.ts --reporter=verbose
Integration tests, with PostgreSQL running: npx vitest run tests/inventory.test.ts --reporter=verbose
App: npm run dev. Check /catalog logged out, then staff@rental.local and admin@rental.local for the inventory pages.


npm install qrcode.react -w client

npx vitest run tests/bookings.unit.test.ts tests/payments.unit.test.ts
npx vitest run tests/booking.test.ts


npx vitest run tests/returns.unit.test.ts
npx vitest run tests/returns.test.ts