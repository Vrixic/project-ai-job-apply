ALTER TABLE jobs.duplicate_candidates
  ADD COLUMN canonical_job_id uuid REFERENCES jobs.canonical_jobs(id),
  ADD COLUMN reviewed_by text,
  ADD COLUMN review_reason_code text,
  ADD COLUMN resolution_version integer NOT NULL DEFAULT 0;

ALTER TABLE jobs.duplicate_candidates
  ADD CONSTRAINT duplicate_candidates_resolution_ck CHECK (
    resolution IS NULL OR resolution IN ('exact', 'related_repost', 'not_duplicate')
  ),
  ADD CONSTRAINT duplicate_candidates_review_state_ck CHECK (
    (
      resolution IS NULL AND reviewed_at IS NULL AND reviewed_by IS NULL
      AND review_reason_code IS NULL AND canonical_job_id IS NULL
    ) OR (
      resolution IS NOT NULL AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL
      AND review_reason_code IS NOT NULL
    )
  ),
  ADD CONSTRAINT duplicate_candidates_canonical_member_ck CHECK (
    (
      resolution = 'exact' AND canonical_job_id IS NOT NULL
      AND canonical_job_id IN (job_id, candidate_job_id)
    )
    OR (resolution IS DISTINCT FROM 'exact' AND canonical_job_id IS NULL)
  ),
  ADD CONSTRAINT duplicate_candidates_reviewer_ck CHECK (
    reviewed_by IS NULL OR (
      reviewed_by = btrim(reviewed_by)
      AND char_length(reviewed_by) BETWEEN 3 AND 200
      AND reviewed_by ~ '^[A-Za-z0-9:_-]+$'
    )
  ),
  ADD CONSTRAINT duplicate_candidates_reason_code_ck CHECK (
    review_reason_code IS NULL OR (
      char_length(review_reason_code) BETWEEN 3 AND 100
      AND review_reason_code ~ '^[a-z0-9][a-z0-9_.:-]+$'
    )
  ),
  ADD CONSTRAINT duplicate_candidates_resolution_version_ck CHECK (resolution_version >= 0);

CREATE UNIQUE INDEX duplicate_candidates_exact_loser_uq
  ON jobs.duplicate_candidates ((
    CASE
      WHEN canonical_job_id = job_id THEN candidate_job_id
      ELSE job_id
    END
  ))
  WHERE resolution = 'exact';

CREATE TABLE jobs.duplicate_resolution_events (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL,
  candidate_job_id uuid NOT NULL,
  previous_resolution text,
  previous_canonical_job_id uuid REFERENCES jobs.canonical_jobs(id),
  resolution text,
  canonical_job_id uuid REFERENCES jobs.canonical_jobs(id),
  reviewed_by text NOT NULL,
  reason_code text NOT NULL,
  occurred_at timestamptz NOT NULL,
  resolution_version integer NOT NULL,
  FOREIGN KEY (job_id, candidate_job_id)
    REFERENCES jobs.duplicate_candidates(job_id, candidate_job_id) ON DELETE CASCADE,
  CONSTRAINT duplicate_resolution_events_resolution_ck CHECK (
    previous_resolution IS NULL
    OR previous_resolution IN ('exact', 'related_repost', 'not_duplicate')
  ),
  CONSTRAINT duplicate_resolution_events_next_resolution_ck CHECK (
    resolution IS NULL OR resolution IN ('exact', 'related_repost', 'not_duplicate')
  ),
  CONSTRAINT duplicate_resolution_events_previous_canonical_ck CHECK (
    (
      previous_resolution = 'exact' AND previous_canonical_job_id IS NOT NULL
      AND previous_canonical_job_id IN (job_id, candidate_job_id)
    )
    OR (previous_resolution IS DISTINCT FROM 'exact' AND previous_canonical_job_id IS NULL)
  ),
  CONSTRAINT duplicate_resolution_events_canonical_ck CHECK (
    (
      resolution = 'exact' AND canonical_job_id IS NOT NULL
      AND canonical_job_id IN (job_id, candidate_job_id)
    )
    OR (resolution IS DISTINCT FROM 'exact' AND canonical_job_id IS NULL)
  ),
  CONSTRAINT duplicate_resolution_events_reviewer_ck CHECK (
    reviewed_by = btrim(reviewed_by)
    AND char_length(reviewed_by) BETWEEN 3 AND 200
    AND reviewed_by ~ '^[A-Za-z0-9:_-]+$'
  ),
  CONSTRAINT duplicate_resolution_events_reason_code_ck CHECK (
    char_length(reason_code) BETWEEN 3 AND 100
    AND reason_code ~ '^[a-z0-9][a-z0-9_.:-]+$'
  ),
  CONSTRAINT duplicate_resolution_events_version_ck CHECK (resolution_version > 0),
  CONSTRAINT duplicate_resolution_events_pair_version_uq
    UNIQUE (job_id, candidate_job_id, resolution_version)
);

CREATE INDEX duplicate_resolution_events_pair_occurred_idx
  ON jobs.duplicate_resolution_events (job_id, candidate_job_id, occurred_at, id);
