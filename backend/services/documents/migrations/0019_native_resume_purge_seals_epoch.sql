-- Replacing a resume purges the old one, and the guarded purge cascades that resume's terminal
-- generations away. The application's admission head then still names an unsealed epoch that no
-- generation proves settled, so every later resume request for the application is refused as unknown
-- and its delivery fails after five attempts. The delete guard has already proved each removed
-- generation terminal, so closing its epoch is exactly what the next admitted request would do.
-- Nothing is reopened here and no generation is created.
CREATE FUNCTION documents.seal_purged_native_resume_epoch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE documents.native_material_admission h
  SET sealed_at = t.at, minimum_work_issued_at = t.at
  FROM (SELECT clock_timestamp() AS at) t
  WHERE h.user_id = OLD.user_id AND h.application_id = OLD.application_id AND h.epoch_id = OLD.epoch_id
    AND h.sealed_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM documents.native_resume_generations g
      WHERE g.user_id = OLD.user_id AND g.application_id = OLD.application_id
        AND g.state NOT IN ('retired', 'abandoned', 'launch_rejected'))
    AND NOT EXISTS (
      SELECT 1 FROM documents.native_material_allocations a
      WHERE a.user_id = OLD.user_id AND a.application_id = OLD.application_id
        AND a.state NOT IN ('retired', 'abandoned'));
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION documents.seal_purged_native_resume_epoch() FROM PUBLIC;
CREATE TRIGGER native_resume_generation_purge_seal AFTER DELETE ON documents.native_resume_generations
  FOR EACH ROW EXECUTE FUNCTION documents.seal_purged_native_resume_epoch();

-- Repair applications already left in that state: an unsealed head with no generation and no
-- allocation at all can only be the remainder of a purge. A head that still has either is untouched.
UPDATE documents.native_material_admission h
SET sealed_at = t.at, minimum_work_issued_at = t.at
FROM (SELECT clock_timestamp() AS at) t
WHERE h.sealed_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM documents.native_resume_generations g
    WHERE g.user_id = h.user_id AND g.application_id = h.application_id)
  AND NOT EXISTS (
    SELECT 1 FROM documents.native_material_allocations a
    WHERE a.user_id = h.user_id AND a.application_id = h.application_id);
