-- claim_host(p_party_id, p_guest_id) — atomic host claim.
--
-- If parties.host_guest_id IS NULL, sets it to p_guest_id and returns the
-- now-current host_guest_id. If it's already set, returns whatever is there
-- (so the caller can compare and decide "you're the host" vs "denied").
--
-- SECURITY DEFINER for the same reason as assign_guest — works against
-- the anon client without exposing the service-role key client-side.

CREATE OR REPLACE FUNCTION public.claim_host(
  p_party_id  UUID,
  p_guest_id  UUID
) RETURNS UUID AS $$
DECLARE
  v_host UUID;
BEGIN
  UPDATE parties
     SET host_guest_id = p_guest_id
   WHERE id = p_party_id AND host_guest_id IS NULL
  RETURNING host_guest_id INTO v_host;

  IF v_host IS NULL THEN
    SELECT host_guest_id INTO v_host FROM parties WHERE id = p_party_id;
  END IF;

  RETURN v_host;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.claim_host(UUID, UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.claim_host(UUID, UUID) TO authenticated;
