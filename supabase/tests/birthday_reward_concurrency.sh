#!/usr/bin/env bash
#
# Birthday reward concurrency test script.
#
# This WAS executed against a live local Postgres during development (unlike booking_concurrency.sh's
# disclaimer) — every scenario below passed when run manually via psql before this script existed;
# this automates that same proof so it's repeatable. It exercises the real
# `redeem_birthday_reward_and_book_appointment` Postgres function (migration 049) directly — not
# mocks — which is the only way to actually prove the DB-level idempotency/atomicity/concurrency
# protection holds, not just that the application code calls it correctly.
#
# Usage (local Supabase via Docker, matching this project's dev setup):
#   supabase start   # from the repo root — brings up local Postgres with all migrations applied
#   ./supabase/tests/birthday_reward_concurrency.sh
#
# Set PSQL_CONTAINER to a different container name, or set DATABASE_URL and this script will use
# a plain `psql "$DATABASE_URL"` instead of docker exec, if you have the postgres client installed
# locally and prefer that.
#
# Covers: successful redemption forces price to 0 and marks the reward redeemed; redeeming again
# with nothing left fails cleanly; a booking that fails (slot conflict) leaves the reward
# untouched; two truly concurrent redemption attempts for the same reward — exactly one must win.
# All fixture rows use dedicated UUIDs/far-future dates and are cleaned up at the end.

set -euo pipefail

PSQL_CONTAINER="${PSQL_CONTAINER:-supabase_db_BarberShop-Nizar}"

psql_exec() {
  if [ -n "${DATABASE_URL:-}" ]; then
    psql "$DATABASE_URL" -v ON_ERROR_STOP=0 "$@"
  else
    docker exec -i "$PSQL_CONTAINER" psql -U postgres -v ON_ERROR_STOP=0 "$@"
  fi
}

PROFILE_ID="99999999-9999-9999-9999-999999999901"
BRANCH_ID="99999999-9999-9999-9999-999999999902"
STAFF_ID="99999999-9999-9999-9999-999999999903"
SERVICE_ID="99999999-9999-9999-9999-999999999904"
TEST_DATE="2099-06-15"

pass_count=0
fail_count=0
check() {
  if [ "$1" = "$2" ]; then
    echo "PASS — $3"
    pass_count=$((pass_count + 1))
  else
    echo "FAIL — $3 (expected [$2], got [$1])"
    fail_count=$((fail_count + 1))
  fi
}

cleanup() {
  psql_exec >/dev/null <<SQL
delete from appointments where staff_id = '$STAFF_ID';
delete from birthday_rewards where profile_id = '$PROFILE_ID';
delete from staff_working_days where staff_id = '$STAFF_ID';
delete from staff_service where staff_id = '$STAFF_ID' and service_id = '$SERVICE_ID';
delete from branch_staff where staff_id = '$STAFF_ID' and branch_id = '$BRANCH_ID';
delete from staff where id = '$STAFF_ID';
delete from services where id = '$SERVICE_ID';
delete from branches where id = '$BRANCH_ID';
delete from profiles where id = '$PROFILE_ID';
SQL
}
trap cleanup EXIT

echo "=== Fixtures ==="
psql_exec -v ON_ERROR_STOP=1 >/dev/null <<SQL
insert into profiles (id, phone, first_name, last_name, birth_date)
  values ('$PROFILE_ID', '0500000099', 'Test', 'Birthday', '1990-01-01') on conflict (id) do nothing;
insert into branches (id, name, name_he, name_ar, is_active)
  values ('$BRANCH_ID', 'Birthday Test Branch', 'Birthday Test Branch', 'Birthday Test Branch', true) on conflict (id) do nothing;
insert into staff (id, name, is_active) values ('$STAFF_ID', 'Birthday Test Staff', true) on conflict (id) do nothing;
insert into services (id, name, name_he, name_ar, price, duration, is_active)
  values ('$SERVICE_ID', 'Birthday Test Service', 'Birthday Test Service', 'Birthday Test Service', 100, 40, true) on conflict (id) do nothing;
insert into branch_staff (branch_id, staff_id) values ('$BRANCH_ID', '$STAFF_ID') on conflict do nothing;
insert into staff_service (staff_id, service_id, price, duration) values ('$STAFF_ID', '$SERVICE_ID', 100, 40)
  on conflict (staff_id, service_id) do update set duration = 40;
insert into staff_working_days (staff_id, day_of_week, start_time, end_time)
  select '$STAFF_ID', d, '09:00', '19:00' from generate_series(0,6) d on conflict (staff_id, day_of_week) do nothing;
delete from appointments where staff_id = '$STAFF_ID';
delete from birthday_rewards where profile_id = '$PROFILE_ID';
SQL

redeem_sql() {
  local time="$1"
  cat <<SQL
select id, price from redeem_birthday_reward_and_book_appointment(
  p_profile_id := '$PROFILE_ID', p_client_phone := '0500000099', p_client_name := 'Test Birthday',
  p_branch_id := '$BRANCH_ID', p_staff_id := '$STAFF_ID', p_service_id := '$SERVICE_ID',
  p_date := '$TEST_DATE', p_time := '$time', p_duration := 40,
  p_service_name := 'x', p_staff_name := 'x', p_branch_name := 'x'
);
SQL
}

echo "=== Scenario: successful redemption forces price to 0 and marks the reward redeemed ==="
psql_exec -v ON_ERROR_STOP=1 >/dev/null <<SQL
insert into birthday_rewards (profile_id, birthday_year, expires_at)
  values ('$PROFILE_ID', 2030, now() + interval '10 days');
SQL
psql_exec -v ON_ERROR_STOP=1 >/dev/null <<< "$(redeem_sql '10:00')"
price=$(psql_exec -t -A -c "select price from appointments where staff_id='$STAFF_ID' and time='10:00:00'")
check "$price" "0" "booked appointment price is forced to 0"
redeemed=$(psql_exec -t -A -c "select redeemed_at is not null from birthday_rewards where profile_id='$PROFILE_ID' and birthday_year=2030")
check "$redeemed" "t" "reward marked redeemed"

echo "=== Scenario: redeeming again with nothing left fails ==="
set +e
out=$(psql_exec <<< "$(redeem_sql '11:00')" 2>&1)
set -e
if echo "$out" | grep -q "NO_BIRTHDAY_REWARD"; then
  check "1" "1" "second redemption correctly rejected (NO_BIRTHDAY_REWARD)"
else
  check "0" "1" "second redemption correctly rejected (NO_BIRTHDAY_REWARD)"
fi

echo "=== Scenario: a failed booking (slot conflict) leaves the reward untouched ==="
psql_exec -v ON_ERROR_STOP=1 >/dev/null <<SQL
insert into birthday_rewards (profile_id, birthday_year, expires_at)
  values ('$PROFILE_ID', 2028, now() + interval '10 days');
SQL
set +e
psql_exec <<< "$(redeem_sql '10:00')" >/dev/null 2>&1
set -e
still_unredeemed=$(psql_exec -t -A -c "select redeemed_at is null from birthday_rewards where profile_id='$PROFILE_ID' and birthday_year=2028")
check "$still_unredeemed" "t" "reward left unredeemed after a failed booking attempt"

echo "=== Scenario: two truly concurrent redemptions for the same reward — exactly one must win ==="
# Clean slate: earlier scenarios left a redeemed 2030 reward + its appointment, and an
# intentionally-failed (still unredeemed) 2028 reward. Both must be cleared so this scenario
# isolates "two concurrent claims on the SAME single reward row" -- otherwise the loser could
# legitimately fall through to redeem the leftover 2028 reward instead (a different, still-valid
# row), which is correct behavior in general but not what this specific scenario is testing.
psql_exec -v ON_ERROR_STOP=1 >/dev/null <<SQL
delete from appointments where staff_id = '$STAFF_ID';
delete from birthday_rewards where profile_id = '$PROFILE_ID';
insert into birthday_rewards (profile_id, birthday_year, expires_at)
  values ('$PROFILE_ID', 2027, now() + interval '10 days');
SQL
(
  psql_exec <<SQL &
select pg_sleep(0.2);
$(redeem_sql '12:00')
SQL
  psql_exec <<SQL &
select pg_sleep(0.2);
$(redeem_sql '13:00')
SQL
  wait
)
confirmed_count=$(psql_exec -t -A -c "select count(*) from appointments where staff_id='$STAFF_ID' and time in ('12:00:00','13:00:00')")
check "$confirmed_count" "1" "exactly one concurrent redemption produced an appointment"
redeemed_2027=$(psql_exec -t -A -c "select redeemed_at is not null from birthday_rewards where profile_id='$PROFILE_ID' and birthday_year=2027")
check "$redeemed_2027" "t" "the 2027 reward ended up redeemed exactly once"

echo ""
echo "=== Summary: $pass_count passed, $fail_count failed ==="
[ "$fail_count" -eq 0 ]
