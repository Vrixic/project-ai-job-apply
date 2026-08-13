ALTER TABLE jobs.canonical_jobs
  ADD COLUMN search_document tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple'::regconfig, coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple'::regconfig, coalesce(department, '')), 'B') ||
    setweight(to_tsvector('simple'::regconfig, coalesce(description, '')), 'C')
  ) STORED;

CREATE INDEX canonical_jobs_search_document_gin
  ON jobs.canonical_jobs USING gin (search_document);
CREATE INDEX canonical_jobs_normalized_locations_gin
  ON jobs.canonical_jobs USING gin (normalized_locations);
CREATE INDEX canonical_jobs_normalized_title_idx
  ON jobs.canonical_jobs (normalized_title);
CREATE INDEX canonical_jobs_active_verified_idx
  ON jobs.canonical_jobs (last_verified_at DESC, id)
  WHERE status = 'active';

CREATE TABLE jobs.catalog_search_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0)
);

INSERT INTO jobs.catalog_search_state (singleton, revision) VALUES (true, 1);

CREATE FUNCTION jobs.advance_catalog_search_revision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE jobs.catalog_search_state SET revision = revision + 1 WHERE singleton = true;
  RETURN NULL;
END;
$$;

CREATE TRIGGER canonical_jobs_search_revision
AFTER INSERT OR UPDATE OR DELETE ON jobs.canonical_jobs
FOR EACH STATEMENT EXECUTE FUNCTION jobs.advance_catalog_search_revision();

CREATE TRIGGER companies_search_revision
AFTER INSERT OR UPDATE OR DELETE ON jobs.companies
FOR EACH STATEMENT EXECUTE FUNCTION jobs.advance_catalog_search_revision();

CREATE TRIGGER duplicate_candidates_search_revision
AFTER INSERT OR UPDATE OR DELETE ON jobs.duplicate_candidates
FOR EACH STATEMENT EXECUTE FUNCTION jobs.advance_catalog_search_revision();
