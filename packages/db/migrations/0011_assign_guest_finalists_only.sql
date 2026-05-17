-- assign_guest now restricts country picks to the Gemini-ingested finalists
-- for this party (event_timeline rows with category='performance'). Without
-- this filter guests could be assigned a non-finalist country and end up
-- with nothing to root for.
--
-- New error: SQLSTATE 22023 + 'LINEUP_NOT_LOADED' when the producer hasn't
-- ingested the structure yet. Web action maps it to a friendly message.

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
  v_finalist_count INT;
BEGIN
  -- idempotent: if guest already exists, return them
  SELECT * INTO existing FROM guests WHERE id = p_guest_id AND party_id = p_party_id;
  IF FOUND THEN
    RETURN existing;
  END IF;

  -- Block joins until the producer has ingested the final lineup.
  SELECT COUNT(*) INTO v_finalist_count
  FROM event_timeline
  WHERE party_id = p_party_id
    AND category = 'performance'
    AND country_code IS NOT NULL;

  IF v_finalist_count = 0 THEN
    RAISE EXCEPTION 'LINEUP_NOT_LOADED' USING ERRCODE = '22023';
  END IF;

  -- pick 2 random unassigned finalist countries, locking the rows to avoid races
  SELECT array_agg(code) INTO picked FROM (
    SELECT code FROM countries
    WHERE code IN (
      SELECT DISTINCT country_code FROM event_timeline
      WHERE party_id = p_party_id
        AND category = 'performance'
        AND country_code IS NOT NULL
    )
    AND code NOT IN (
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
