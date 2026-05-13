-- ingest_payload(p_party_id, p_payload jsonb) — single-transaction ingest of
-- the producer JSON pasted into /admin/setup.
--
-- Design notes:
--  * SECURITY DEFINER so the call works with the anon client (no service-role
--    needed in the browser). The function is owned by the schema owner (the
--    Supabase superuser) which already has full write privileges.
--  * Idempotent: clears existing event_timeline + scheduled_commentary for
--    this party first, then re-inserts. Side bets, guests, votes, reactions
--    are untouched — re-ingesting is safe even mid-party.
--  * Event idx convention (matches the brief):
--      performances:  idx = running_order (1..N)
--      other_events:  idx = 1000 + (position in array)  (so no collision)
--      scheduled_commentary event_idx left as-supplied (may be NULL).
--  * Also UPDATEs countries.{artist, song_title, vibe_blurb, fun_fact,
--    running_order} from the payload so the lobby/live screens have rich
--    metadata; and parties.yt_video_id.
--  * Returns a counts JSON so the UI can show a confirmation message.

CREATE OR REPLACE FUNCTION public.ingest_payload(
  p_party_id   UUID,
  p_payload    JSONB
) RETURNS JSONB AS $$
DECLARE
  v_yt_video_id  TEXT;
  v_perf_count   INT := 0;
  v_other_count  INT := 0;
  v_sched_count  INT := 0;
  v_roast_count  INT := 0;
  v_country_count INT := 0;
  v_perf         JSONB;
  v_other        JSONB;
  v_sched        JSONB;
  v_roast        JSONB;
  v_i            INT;
BEGIN
  -- Ensure party exists.
  PERFORM 1 FROM parties WHERE id = p_party_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PARTY_NOT_FOUND' USING ERRCODE = '22023';
  END IF;

  v_yt_video_id := p_payload->>'yt_video_id';
  IF v_yt_video_id IS NULL OR length(v_yt_video_id) < 5 THEN
    RAISE EXCEPTION 'YT_VIDEO_ID_REQUIRED' USING ERRCODE = '22023';
  END IF;

  -- Wipe prior timeline + commentary for this party (idempotent re-ingest).
  DELETE FROM event_timeline WHERE party_id = p_party_id;
  DELETE FROM scheduled_commentary WHERE party_id = p_party_id;

  -- Performances → event_timeline (category='performance').
  FOR v_perf IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'performances','[]'::jsonb))
  LOOP
    INSERT INTO event_timeline (
      party_id, idx, category, start_seconds, end_seconds,
      description, country_code, song_idx
    ) VALUES (
      p_party_id,
      (v_perf->>'running_order')::INT,
      'performance',
      (v_perf->>'start_seconds')::INT,
      (v_perf->>'end_seconds')::INT,
      COALESCE(v_perf->>'artist','') || ' — ' || COALESCE(v_perf->>'song_title',''),
      upper(v_perf->>'country_code'),
      (v_perf->>'running_order')::INT
    );

    -- Country metadata update (only the fields the payload owns).
    UPDATE countries SET
      artist        = v_perf->>'artist',
      song_title    = v_perf->>'song_title',
      vibe_blurb    = v_perf->>'vibe_blurb',
      fun_fact      = v_perf->>'fun_fact',
      running_order = (v_perf->>'running_order')::INT
    WHERE code = upper(v_perf->>'country_code');

    IF FOUND THEN
      v_country_count := v_country_count + 1;
    END IF;

    v_perf_count := v_perf_count + 1;
  END LOOP;

  -- Other events → event_timeline with synthetic idx (1000 + position).
  v_i := 0;
  FOR v_other IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'other_events','[]'::jsonb))
  LOOP
    v_i := v_i + 1;
    INSERT INTO event_timeline (
      party_id, idx, category, start_seconds, end_seconds,
      description, country_code, song_idx
    ) VALUES (
      p_party_id,
      1000 + v_i,
      v_other->>'category',
      (v_other->>'start_seconds')::INT,
      NULL,
      v_other->>'description',
      NULL,
      NULL
    );
    v_other_count := v_other_count + 1;
  END LOOP;

  -- Scheduled commentary → scheduled_commentary (category='scheduled').
  FOR v_sched IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'scheduled_commentary','[]'::jsonb))
  LOOP
    INSERT INTO scheduled_commentary (
      party_id, category, trigger_seconds, speaker, content, event_idx, fired
    ) VALUES (
      p_party_id,
      'scheduled',
      (v_sched->>'trigger_seconds')::INT,
      v_sched->>'speaker',
      v_sched->>'content',
      NULLIF(v_sched->>'event_idx','')::INT,
      FALSE
    );
    v_sched_count := v_sched_count + 1;
  END LOOP;

  -- Roast pool → scheduled_commentary (category='roast', trigger_seconds NULL).
  FOR v_roast IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'roast_pool','[]'::jsonb))
  LOOP
    INSERT INTO scheduled_commentary (
      party_id, category, trigger_seconds, speaker, content, event_idx, fired
    ) VALUES (
      p_party_id,
      'roast',
      NULL,
      v_roast->>'speaker',
      v_roast->>'content',
      (v_roast->>'event_idx')::INT,
      FALSE
    );
    v_roast_count := v_roast_count + 1;
  END LOOP;

  -- yt_video_id on the party row.
  UPDATE parties SET yt_video_id = v_yt_video_id WHERE id = p_party_id;

  RETURN jsonb_build_object(
    'performances', v_perf_count,
    'other_events', v_other_count,
    'scheduled_commentary', v_sched_count,
    'roast_pool', v_roast_count,
    'countries_updated', v_country_count
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.ingest_payload(UUID, JSONB) TO anon;
GRANT EXECUTE ON FUNCTION public.ingest_payload(UUID, JSONB) TO authenticated;
