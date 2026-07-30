-- Admin: paginated list of registered customers (profiles with session, not admin, not staff-linked, not staff phone)
CREATE OR REPLACE FUNCTION public.admin_customers_list(
  p_search text DEFAULT NULL,
  p_page int DEFAULT 1,
  p_limit int DEFAULT 20
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH bounds AS (
    SELECT
      GREATEST(1, COALESCE(p_page, 1)) AS pg,
      LEAST(100, GREATEST(1, COALESCE(p_limit, 20))) AS lim
  ),
  offs AS (
    SELECT pg, lim, ((pg - 1) * lim)::int AS off FROM bounds
  ),
  eligible AS (
    SELECT p.id, p.first_name, p.last_name, p.phone, p.birth_date, p.created_at
    FROM profiles p
    WHERE p.is_admin = false
      AND p.api_token IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM staff s
        WHERE s.profile_id = p.id AND s.is_active = true
      )
      AND NOT EXISTS (
        SELECT 1 FROM staff s
        WHERE s.is_active = true
          AND s.phone IS NOT NULL
          AND p.phone IS NOT NULL
          AND length(regexp_replace(p.phone, '\D', '', 'g')) >= 9
          AND right(regexp_replace(s.phone, '\D', '', 'g'), 9) = right(regexp_replace(p.phone, '\D', '', 'g'), 9)
      )
  ),
  filtered AS (
    SELECT e.*
    FROM eligible e
    WHERE p_search IS NULL OR trim(p_search) = ''
       OR (e.first_name IS NOT NULL AND e.first_name ILIKE '%' || trim(p_search) || '%')
       OR (e.last_name IS NOT NULL AND e.last_name ILIKE '%' || trim(p_search) || '%')
       OR (e.phone IS NOT NULL AND e.phone ILIKE '%' || trim(p_search) || '%')
  ),
  filtered_count AS (
    SELECT COUNT(*)::int AS c FROM filtered
  ),
  paged AS (
    SELECT f.*
    FROM filtered f
    ORDER BY f.created_at DESC NULLS LAST
    LIMIT (SELECT lim FROM offs)
    OFFSET (SELECT off FROM offs)
  )
  SELECT jsonb_build_object(
    'items', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', s.id,
            'firstName', s.first_name,
            'lastName', s.last_name,
            'fullName', trim(both ' ' FROM concat_ws(' ', s.first_name, s.last_name)),
            'phone', s.phone,
            'birthDate', s.birth_date,
            'createdAt', s.created_at,
            'totalAppointments', COALESCE((SELECT COUNT(*)::int FROM appointments a WHERE a.profile_id = s.id), 0),
            'upcomingAppointments', COALESCE(
              (SELECT COUNT(*)::int FROM appointments a
               WHERE a.profile_id = s.id AND a.status = 'confirmed' AND a.date >= CURRENT_DATE),
              0
            ),
            'lastAppointmentAt', (
              SELECT MAX(a.date::timestamp + a.time) FROM appointments a WHERE a.profile_id = s.id
            )
          )
          ORDER BY s.created_at DESC NULLS LAST
        )
        FROM paged s
      ),
      '[]'::jsonb
    ),
    'total', (SELECT c FROM filtered_count),
    'page', (SELECT pg FROM offs),
    'limit', (SELECT lim FROM offs)
  );
$$;

REVOKE ALL ON FUNCTION public.admin_customers_list(text, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_customers_list(text, int, int) TO service_role;
