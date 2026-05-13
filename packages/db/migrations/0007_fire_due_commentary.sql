-- fire_due_commentary(p_party_id, p_seconds) — atomic "fire any scheduled
-- commentary whose trigger_seconds <= current playback".
--
-- Called every 2s from the Electron main process. Flipping `fired` inside a
-- single UPDATE..RETURNING means even if two Electron instances ran (we don't,
-- but the design tolerates it) every row fires at most once.
--
-- Only category='scheduled' fires here. Roasts (`category='roast'`) are claimed
-- on-demand by the phone via the existing trigger_roast server action.
--
-- SECURITY DEFINER so the anon role *could* run it, but we deliberately do NOT
-- grant EXECUTE to anon — only authenticated/service_role. Electron uses the
-- service-role key.

CREATE OR REPLACE FUNCTION public.fire_due_commentary(
  p_party_id  UUID,
  p_seconds   INT
) RETURNS TABLE (
  id           UUID,
  speaker      TEXT,
  content      TEXT,
  event_idx    INT
) AS $$
BEGIN
  RETURN QUERY
  UPDATE scheduled_commentary AS sc
     SET fired = TRUE,
         fired_at = NOW()
   WHERE sc.party_id = p_party_id
     AND sc.category = 'scheduled'
     AND sc.fired = FALSE
     AND sc.trigger_seconds IS NOT NULL
     AND sc.trigger_seconds <= p_seconds
  RETURNING sc.id, sc.speaker, sc.content, sc.event_idx;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.fire_due_commentary(UUID, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.fire_due_commentary(UUID, INT) TO authenticated;
