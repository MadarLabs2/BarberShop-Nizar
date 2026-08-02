-- Deleting a service/branch has always only deactivated it (is_active = false); the staff_service
-- / branch_staff link rows pointing at it were never cleaned up. Those catalog-read queries filter
-- joined services/branches to is_active = true, but did not drop the now-dangling link row itself
-- — so a deactivated service still showed up in the booking picker as a phantom entry (its real
-- name unresolved, falling back to the placeholder text "טיפול", still carrying its old stale
-- price/duration from the leftover staff_service row). The API-level read path (apps/api/src/
-- catalog.ts) and deleteService/deleteBranch (apps/api/src/modules/admin-catalog.ts) are fixed
-- separately to stop this from recurring; this migration removes the orphaned rows that already
-- exist. Only removes link rows — never touches services/branches/appointments themselves.

DELETE FROM staff_service
WHERE service_id NOT IN (SELECT id FROM services WHERE is_active = true);

DELETE FROM branch_staff
WHERE branch_id NOT IN (SELECT id FROM branches WHERE is_active = true);
