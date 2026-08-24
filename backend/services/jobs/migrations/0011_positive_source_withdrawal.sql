ALTER TABLE jobs.job_sources
  ADD COLUMN withdrawn_at timestamptz;

ALTER TABLE jobs.job_sources
  ADD CONSTRAINT job_sources_withdrawn_at_ck CHECK (
    withdrawn_at IS NULL OR (
      withdrawn_at >= first_observed_at
      AND withdrawn_at <= last_verified_at
    )
  );

CREATE INDEX job_sources_active_job_idx
  ON jobs.job_sources (job_id)
  WHERE withdrawn_at IS NULL;
