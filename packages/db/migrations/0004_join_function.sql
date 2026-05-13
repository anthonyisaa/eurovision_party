-- assign_guest(p_party_id, p_guest_id, p_display) is the race-safe join RPC.
--
-- Why a SECURITY DEFINER function rather than client-side SQL?
--   - Two concurrent joins must never both grab the same country. The CTE
--     below uses FOR UPDATE on the candidate country rows so the second
--     transaction sees the first one's pick.
--   - Anon clients can call it (GRANT EXECUTE ... TO anon) without us
--     having to ship the service-role key to the browser.
--   - The function is idempotent: if a guest row already exists for the
--     (party_id, guest_id) pair it's returned unchanged, so refreshes /
--     network blips don't burn extra country slots.
--
-- Errors out with SQLSTATE 22023 + message 'PARTY_FULL' when fewer than 2
-- unassigned countries remain. The web action maps that to a friendly UX.

CREATE OR REPLACE FUNCTION public.assign_guest(
  p_party_id   UUID,
  p_guest_id   UUID,
  p_display    TEXT
) RETURNS guests AS $$
DECLARE
  picked TEXT[];
  c1 TEXT;
  c2 TEXT;
  existing guests%ROWTYPE;
  new_row  guests%ROWTYPE;
BEGIN
  -- idempotent: if guest already exists, return them
  SELECT * INTO existing FROM guests WHERE id = p_guest_id AND party_id = p_party_id;
  IF FOUND THEN
    RETURN existing;
  END IF;

  -- pick 2 random unassigned countries, locking the rows to avoid races
  SELECT array_agg(code) INTO picked FROM (
    SELECT code FROM countries
    WHERE code NOT IN (
      SELECT assigned_country_1 FROM guests WHERE party_id = p_party_id AND assigned_country_1 IS NOT NULL
      UNION
      SELECT assigned_country_2 FROM guests WHERE party_id = p_party_id AND assigned_country_2 IS NOT NULL
    )
    ORDER BY random()
    LIMIT 2
    FOR UPDATE
  ) sub;

  IF picked IS NULL OR array_length(picked, 1) < 2 THEN
    RAISE EXCEPTION 'PARTY_FULL' USING ERRCODE = '22023';
  END IF;

  c1 := picked[1];
  c2 := picked[2];

  INSERT INTO guests (id, party_id, display_name, assigned_country_1, assigned_country_2)
  VALUES (p_guest_id, p_party_id, p_display, c1, c2)
  RETURNING * INTO new_row;

  RETURN new_row;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.assign_guest(UUID, UUID, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.assign_guest(UUID, UUID, TEXT) TO authenticated;
