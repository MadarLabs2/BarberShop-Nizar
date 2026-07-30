-- Staff-specific price and duration per service assignment
-- Extends existing staff_service (no new table)

ALTER TABLE staff_service
  ADD COLUMN IF NOT EXISTS price INTEGER,
  ADD COLUMN IF NOT EXISTS duration INTEGER;

-- Backfill from services table
UPDATE staff_service ss
SET price = s.price, duration = s.duration
FROM services s
WHERE ss.service_id = s.id AND (ss.price IS NULL OR ss.duration IS NULL);

-- Fallback for any rows missed
UPDATE staff_service SET price = COALESCE(price, 0), duration = COALESCE(duration, 40) WHERE price IS NULL OR duration IS NULL;

-- Harden: NOT NULL and valid range
ALTER TABLE staff_service
  ALTER COLUMN price SET NOT NULL,
  ALTER COLUMN duration SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_staff_service_price') THEN
    ALTER TABLE staff_service ADD CONSTRAINT chk_staff_service_price CHECK (price >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_staff_service_duration') THEN
    ALTER TABLE staff_service ADD CONSTRAINT chk_staff_service_duration CHECK (duration >= 5 AND duration <= 180);
  END IF;
END $$;
