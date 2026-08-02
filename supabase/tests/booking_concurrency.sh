#!/usr/bin/env bash
#
# Booking concurrency test script.
#
# IMPORTANT: this was written but NEVER EXECUTED by the assistant that authored it — the sandbox
# it ran in has no running Docker/Postgres, so there was no live database to test against. It has
# been carefully hand-reviewed against migrations 040-043 for correctness, but you should treat it
# as unverified until you run it yourself. It directly exercises the real Postgres constraints and
# functions (not mocks), which is the only way to actually prove the DB-level concurrency
# protection holds — the mocked Jest controller tests prove the API's logic is correct, not that
# the database itself enforces it under real concurrent connections.
#
# Usage:
#   supabase start   # from the repo root — brings up local Postgres with migrations 001-043 applied
#   DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres" ./supabase/tests/booking_concurrency.sh
#
# Each concurrency scenario fires two writes at the same target (staff+date+time-range) from two
# separate concurrent `psql` connections, synchronized with a shared `pg_sleep` so both reach their
# INSERT/UPDATE at roughly the same instant, then asserts exactly one of the two survives as
# 'confirmed' — proving the protection is real at the database level, not just in application code.
# All fixture rows use a far-future date and dedicated UUIDs so this never touches real data, and
# everything is cleaned up at the end of each scenario (and again at the very end).
#
# Covers, in order: exact same-slot concurrent booking (#1), partial-overlap concurrent booking
# (#2), a booking racing a concurrent admin block that only PARTIALLY overlaps it (#12/B3),
# rescheduling racing a concurrent new booking for the same slot (#7), and a dedicated (sequential,
# non-concurrent) correctness suite for the blocked-slot cancellation predicate covering several
# partial-overlap shapes, not just full containment (#12c).

set -euo pipefail
: "${DATABASE_URL:?Set DATABASE_URL to a Postgres connection string with migrations 001-043 applied}"

STAFF_ID="11111111-1111-1111-1111-111111111111"
BRANCH_ID="22222222-2222-2222-2222-222222222222"
SERVICE_ID="33333333-3333-3333-3333-333333333333"
TEST_DATE="2099-06-15"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 >/dev/null <<SQL
insert into branches (id, name, is_active) values ('$BRANCH_ID', 'Concurrency Test Branch', true)
  on conflict (id) do nothing;
insert into staff (id, name, is_active) values ('$STAFF_ID', 'Concurrency Test Staff', true)
  on conflict (id) do nothing;
insert into services (id, name, price, duration, is_active) values ('$SERVICE_ID', 'Concurrency Test Service', 100, 40, true)
  on conflict (id) do nothing;
insert into branch_staff (branch_id, staff_id) values ('$BRANCH_ID', '$STAFF_ID')
  on conflict do nothing;
insert into staff_service (staff_id, service_id, price, duration) values ('$STAFF_ID', '$SERVICE_ID', 100, 40)
  on conflict (staff_id, service_id) do update set duration = 40;
delete from appointments where staff_id = '$STAFF_ID' and date = '$TEST_DATE';
delete from blocked_slots where staff_id = '$STAFF_ID' and date = '$TEST_DATE';
SQL

run_concurrent_inserts() {
  local time1="$1" time2="$2" label="$3"
  echo "=== $label ==="
  (
    psql "$DATABASE_URL" -v ON_ERROR_STOP=0 <<SQL &
select pg_sleep(0.2);
insert into appointments (profile_id, client_phone, client_name, branch_id, staff_id, service_id, date, time, duration, status, service_name, staff_name, branch_name, price)
values (null, '0500000001', 'Test A', '$BRANCH_ID', '$STAFF_ID', '$SERVICE_ID', '$TEST_DATE', '$time1', 40, 'confirmed', 'x', 'x', 'x', 100);
SQL
    psql "$DATABASE_URL" -v ON_ERROR_STOP=0 <<SQL &
select pg_sleep(0.2);
insert into appointments (profile_id, client_phone, client_name, branch_id, staff_id, service_id, date, time, duration, status, service_name, staff_name, branch_name, price)
values (null, '0500000002', 'Test B', '$BRANCH_ID', '$STAFF_ID', '$SERVICE_ID', '$TEST_DATE', '$time2', 40, 'confirmed', 'x', 'x', 'x', 100);
SQL
    wait
  )
  local count
  count=$(psql "$DATABASE_URL" -t -A -c "select count(*) from appointments where staff_id='$STAFF_ID' and date='$TEST_DATE' and status='confirmed'")
  psql "$DATABASE_URL" -c "delete from appointments where staff_id='$STAFF_ID' and date='$TEST_DATE'" >/dev/null
  if [ "$count" -eq 1 ]; then
    echo "PASS — exactly 1 confirmed appointment survived (expected exactly 1)"
  else
    echo "FAIL — $count confirmed appointments survived (expected exactly 1)"
  fi
}

run_concurrent_inserts "10:00" "10:00" "Scenario #1: two users book the exact same slot simultaneously"
run_concurrent_inserts "10:00" "10:20" "Scenario #2: two users book partially overlapping slots simultaneously (40-min service, 20-min stagger)"

echo "=== Scenario #12 / B3: a booking vs. a concurrent admin block that only PARTIALLY overlaps it (not full containment) ==="
(
  # Must go through create_or_reschedule_appointment (matching apps/api/src/bookings.ts, which
  # never does a raw INSERT) — that's the only path that takes the migration 043 advisory lock.
  # A raw INSERT bypasses the lock entirely and can't be protected by it, since the lock is
  # cooperative: it only serializes writers that actually acquire it.
  psql "$DATABASE_URL" -v ON_ERROR_STOP=0 <<SQL &
select pg_sleep(0.2);
select * from create_or_reschedule_appointment(null, null, '0500000003', 'Test C', '$BRANCH_ID'::uuid, '$STAFF_ID'::uuid, '$SERVICE_ID'::uuid, '$TEST_DATE'::date, '14:00', 40, 'x', 'x', 'x', 100);
SQL
  psql "$DATABASE_URL" -v ON_ERROR_STOP=0 <<SQL &
select pg_sleep(0.2);
-- 14:20-15:00 overlaps only the LAST 20 minutes of the 14:00-14:40 appointment above — a partial
-- overlap, not full containment (the earlier full-containment case is covered by #12c below).
select * from add_blocked_slot_and_cancel_overlaps('$STAFF_ID'::uuid, '$TEST_DATE'::date, '14:20', 40);
SQL
  wait
)
result=$(psql "$DATABASE_URL" -t -A -c "select count(*) from appointments where staff_id='$STAFF_ID' and date='$TEST_DATE' and status='confirmed' and time = '14:00'")
if [ "$result" -eq 0 ]; then
  echo "PASS — no confirmed appointment survived inside the partially-blocked window (either rejected outright, or cancelled by the block)"
else
  echo "FAIL — a confirmed appointment survived despite only a partial overlap with the blocked range — the migration 043 fix did not hold"
fi
psql "$DATABASE_URL" -c "delete from appointments where staff_id='$STAFF_ID' and date='$TEST_DATE'; delete from blocked_slots where staff_id='$STAFF_ID' and date='$TEST_DATE';" >/dev/null

echo "=== Scenario #7: rescheduling into a slot vs. a concurrent new booking for that same slot ==="
# `| head -n 1`: some psql/connection-pooling setups print the "INSERT 0 1" command tag on its own
# line after the RETURNING value even with -t -A, which would otherwise corrupt this capture into
# an invalid UUID string ("<uuid>\nINSERT 0 1") and silently break one side of the race below.
existing_id=$(psql "$DATABASE_URL" -t -A -c "
insert into appointments (profile_id, client_phone, client_name, branch_id, staff_id, service_id, date, time, duration, status, service_name, staff_name, branch_name, price)
values (null, '0500000004', 'Test D', '$BRANCH_ID', '$STAFF_ID', '$SERVICE_ID', '$TEST_DATE', '16:00', 40, 'confirmed', 'x', 'x', 'x', 100)
returning id;" | head -n 1)
(
  psql "$DATABASE_URL" -v ON_ERROR_STOP=0 <<SQL &
select pg_sleep(0.2);
select * from create_or_reschedule_appointment('$existing_id'::uuid, null, '0500000004', 'Test D', '$BRANCH_ID'::uuid, '$STAFF_ID'::uuid, '$SERVICE_ID'::uuid, '$TEST_DATE'::date, '17:00', 40, 'x', 'x', 'x', 100);
SQL
  psql "$DATABASE_URL" -v ON_ERROR_STOP=0 <<SQL &
select pg_sleep(0.2);
select * from create_or_reschedule_appointment(null, null, '0500000005', 'Test E', '$BRANCH_ID'::uuid, '$STAFF_ID'::uuid, '$SERVICE_ID'::uuid, '$TEST_DATE'::date, '17:00', 40, 'x', 'x', 'x', 100);
SQL
  wait
)
count=$(psql "$DATABASE_URL" -t -A -c "select count(*) from appointments where staff_id='$STAFF_ID' and date='$TEST_DATE' and status='confirmed' and time='17:00'")
if [ "$count" -eq 1 ]; then
  echo "PASS — exactly 1 confirmed appointment landed on 17:00 (reschedule and new booking correctly serialized)"
else
  echo "FAIL — $count confirmed appointments landed on 17:00 (expected exactly 1)"
fi
psql "$DATABASE_URL" -c "delete from appointments where staff_id='$STAFF_ID' and date='$TEST_DATE';" >/dev/null

# Scenario #12c: dedicated, sequential (non-concurrent) correctness suite for the blocked-slot
# cancellation predicate itself — proves add_blocked_slot_and_cancel_overlaps correctly identifies
# a PARTIAL overlap (both a block trailing off the end of an appointment and one leading into its
# start), not just the full-containment case, plus adjacent-but-not-overlapping negative controls
# at both boundaries (half-open interval). Mirrors apps/api/test/bookings.slots.spec.ts's
# `blockOverlapsAppointment` suite, but against the real function instead of a TS reimplementation.
check_block_cancellation() {
  local appt_time="$1" appt_dur="$2" block_time="$3" block_dur="$4" expect_cancelled="$5" label="$6"
  echo "=== Scenario #12c: $label ==="
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 >/dev/null <<SQL
delete from appointments where staff_id = '$STAFF_ID' and date = '$TEST_DATE';
delete from blocked_slots where staff_id = '$STAFF_ID' and date = '$TEST_DATE';
insert into appointments (profile_id, client_phone, client_name, branch_id, staff_id, service_id, date, time, duration, status, service_name, staff_name, branch_name, price)
values (null, '0500000009', 'Test P', '$BRANCH_ID', '$STAFF_ID', '$SERVICE_ID', '$TEST_DATE', '$appt_time', $appt_dur, 'confirmed', 'x', 'x', 'x', 100);
SQL
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c \
    "select * from add_blocked_slot_and_cancel_overlaps('$STAFF_ID'::uuid, '$TEST_DATE'::date, '$block_time', $block_dur);" >/dev/null
  local status
  status=$(psql "$DATABASE_URL" -t -A -c \
    "select status from appointments where staff_id='$STAFF_ID' and date='$TEST_DATE' and time='$appt_time'::time")
  if [ "$expect_cancelled" = "yes" ] && [ "$status" = "cancelled" ]; then
    echo "PASS — appointment was cancelled as expected"
  elif [ "$expect_cancelled" = "no" ] && [ "$status" = "confirmed" ]; then
    echo "PASS — appointment correctly left confirmed (non-overlapping)"
  else
    echo "FAIL — expected cancelled='$expect_cancelled' but appointment status is '$status'"
  fi
  psql "$DATABASE_URL" -c "delete from appointments where staff_id='$STAFF_ID' and date='$TEST_DATE'; delete from blocked_slots where staff_id='$STAFF_ID' and date='$TEST_DATE';" >/dev/null
}

check_block_cancellation "14:00" 40 "14:20" 40 "yes" "partial overlap at the END of the appointment (14:00-14:40 appt, 14:20-15:00 block)"
check_block_cancellation "14:00" 40 "13:40" 40 "yes" "partial overlap at the START of the appointment (14:00-14:40 appt, 13:40-14:20 block)"
check_block_cancellation "14:00" 40 "13:30" 90 "yes" "full containment — regression check (13:30-15:00 block fully contains 14:00-14:40 appt)"
check_block_cancellation "14:00" 40 "14:10" 20 "yes" "appointment fully contains a short block (14:10-14:30 block entirely inside 14:00-14:40 appt)"
check_block_cancellation "14:00" 40 "13:20" 40 "no"  "adjacent, non-overlapping — block ends exactly when appointment starts (13:20-14:00)"
check_block_cancellation "14:00" 40 "14:40" 40 "no"  "adjacent, non-overlapping — block starts exactly when appointment ends (14:40-15:20)"
check_block_cancellation "14:00" 40 "12:00" 30 "no"  "completely disjoint (12:00-12:30 block, nowhere near 14:00-14:40 appt)"

psql "$DATABASE_URL" >/dev/null <<SQL
delete from staff_service where staff_id='$STAFF_ID';
delete from branch_staff where staff_id='$STAFF_ID';
delete from staff where id='$STAFF_ID';
delete from services where id='$SERVICE_ID';
delete from branches where id='$BRANCH_ID';
SQL

echo "Done."
