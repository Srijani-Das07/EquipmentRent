
-- ---------------------------------------------------------------------------
-- Custom constraints Prisma cannot express (appended to the init migration).
-- Guarantees, at the database level, that one physical unit can never have two
-- live bookings with overlapping time ranges, even under heavy concurrency (P3).
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "Booking"
  ADD CONSTRAINT "booking_end_after_start" CHECK ("endAt" > "startAt");

ALTER TABLE "Booking"
  ADD CONSTRAINT "booking_no_overlap"
  EXCLUDE USING gist (
    "unitId" WITH =,
    tstzrange("startAt", "endAt", '[)') WITH &&
  )
  WHERE ("status" IN ('PENDING', 'CONFIRMED', 'ACTIVE'));

ALTER TABLE "Charge"
  ADD CONSTRAINT "charge_amount_non_negative" CHECK ("amountPaise" >= 0);

ALTER TABLE "Equipment"
  ADD CONSTRAINT "equipment_rate_positive" CHECK ("dailyRatePaise" > 0 AND "itemValuePaise" > 0);

ALTER TABLE "EquipmentUnit"
  ADD CONSTRAINT "unit_counters_non_negative" CHECK ("lifetimeRentals" >= 0 AND "rentalsSinceMaintenance" >= 0);
