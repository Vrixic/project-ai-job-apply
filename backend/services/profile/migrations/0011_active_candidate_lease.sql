-- Owning Identity API: hold an active-candidate lease until the caller's transaction ends.
-- A shared row lock serializes bounded artifact writes with quarantine/deletion, without
-- allowing Documents or Applications to read Identity tables directly.
CREATE OR REPLACE FUNCTION identity.require_active_candidate(candidate_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, identity
AS $$
DECLARE
  candidate_state text;
BEGIN
  SELECT account_state INTO candidate_state
  FROM identity.users WHERE id = candidate_user_id FOR SHARE;
  IF candidate_state IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'active candidate required' USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION identity.require_active_candidate(uuid) FROM PUBLIC;
