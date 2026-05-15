-- Allow 'celebrate' as a third category alongside 'scheduled' and 'roast'.
-- Replaces the roast-only partial index with a combined reaction index.
-- Updates ingest_payload to accept a unified reaction_pool with a kind field
-- ('roast' | 'celebrate'); the legacy roast_pool key is still accepted for
-- back-compat with older payloads.

ALTER TABLE scheduled_commentary
  DROP CONSTRAINT sched_category_check;
ALTER TABLE scheduled_commentary
  ADD CONSTRAINT sched_category_check CHECK (category IN ('scheduled','roast','celebrate'));

DROP INDEX IF EXISTS scheduled_commentary_roast_pool;
CREATE INDEX scheduled_commentary_reaction_pool
  ON scheduled_commentary (party_id, event_idx, category)
  WHERE category IN ('roast','celebrate') AND fired = FALSE;

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
  v_celeb_count  INT := 0;
  v_country_count INT := 0;
  v_perf         JSONB;
  v_other        JSONB;
  v_sched        JSONB;
  v_react        JSONB;
  v_kind         TEXT;
  v_i            INT;
BEGIN
  PERFORM 1 FROM parties WHERE id = p_party_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PARTY_NOT_FOUND' USING ERRCODE = '22023';
  END IF;

  v_yt_video_id := p_payload->>'yt_video_id';
  IF v_yt_video_id IS NULL OR length(v_yt_video_id) < 5 THEN
    RAISE EXCEPTION 'YT_VIDEO_ID_REQUIRED' USING ERRCODE = '22023';
  END IF;

  DELETE FROM event_timeline WHERE party_id = p_party_id;
  DELETE FROM scheduled_commentary WHERE party_id = p_party_id;

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

  FOR v_react IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'reaction_pool','[]'::jsonb))
  LOOP
    v_kind := lower(v_react->>'kind');
    IF v_kind NOT IN ('roast','celebrate') THEN
      RAISE EXCEPTION 'BAD_REACTION_KIND: %', v_kind USING ERRCODE = '22023';
    END IF;
    INSERT INTO scheduled_commentary (
      party_id, category, trigger_seconds, speaker, content, event_idx, fired
    ) VALUES (
      p_party_id,
      v_kind,
      NULL,
      v_react->>'speaker',
      v_react->>'content',
      (v_react->>'event_idx')::INT,
      FALSE
    );
    IF v_kind = 'roast' THEN
      v_roast_count := v_roast_count + 1;
    ELSE
      v_celeb_count := v_celeb_count + 1;
    END IF;
  END LOOP;

  -- Legacy roast_pool fallback (back-compat).
  FOR v_react IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'roast_pool','[]'::jsonb))
  LOOP
    INSERT INTO scheduled_commentary (
      party_id, category, trigger_seconds, speaker, content, event_idx, fired
    ) VALUES (
      p_party_id,
      'roast',
      NULL,
      v_react->>'speaker',
      v_react->>'content',
      (v_react->>'event_idx')::INT,
      FALSE
    );
    v_roast_count := v_roast_count + 1;
  END LOOP;

  UPDATE parties SET yt_video_id = v_yt_video_id WHERE id = p_party_id;

  RETURN jsonb_build_object(
    'performances', v_perf_count,
    'other_events', v_other_count,
    'scheduled_commentary', v_sched_count,
    'roast_pool', v_roast_count,
    'celebrate_pool', v_celeb_count,
    'countries_updated', v_country_count
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.ingest_payload(UUID, JSONB) TO anon;
GRANT EXECUTE ON FUNCTION public.ingest_payload(UUID, JSONB) TO authenticated;
