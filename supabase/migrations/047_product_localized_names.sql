-- Same multilingual treatment as services/branches (044): admin now enters both a Hebrew and an
-- Arabic name AND description for every product (no auto-translation anywhere). Existing single
-- `name`/`description` values are preserved as the Hebrew value; Arabic is backfilled with the
-- same existing text purely as a safe non-blank placeholder — identical to today's actual
-- behavior, where the same string is shown regardless of app language — until an admin edits it.
--
-- `name` is required today (NOT NULL), so name_he/name_ar follow the exact same
-- add-nullable/backfill/enforce-NOT-NULL pattern as 044. `description` is already nullable today
-- (many products have none), so description_he/description_ar stay nullable too — no backfill
-- needed when the source is NULL, and no NOT NULL to enforce afterward.
--
-- `name`/`description` are kept as server-maintained mirrors of name_he/description_he
-- (apps/api/src/catalog.ts sets them on every write) — every other existing read path keeps
-- working unchanged.

ALTER TABLE products ADD COLUMN IF NOT EXISTS name_he TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS name_ar TEXT;
UPDATE products SET name_he = name WHERE name_he IS NULL;
UPDATE products SET name_ar = name WHERE name_ar IS NULL;
ALTER TABLE products ALTER COLUMN name_he SET NOT NULL;
ALTER TABLE products ALTER COLUMN name_ar SET NOT NULL;

ALTER TABLE products ADD COLUMN IF NOT EXISTS description_he TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS description_ar TEXT;
UPDATE products SET description_he = description WHERE description_he IS NULL AND description IS NOT NULL;
UPDATE products SET description_ar = description WHERE description_ar IS NULL AND description IS NOT NULL;
