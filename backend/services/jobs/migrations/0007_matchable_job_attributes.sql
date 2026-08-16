ALTER TABLE jobs.canonical_jobs
  ADD COLUMN work_mode text,
  ADD COLUMN employment_type text;

ALTER TABLE jobs.canonical_jobs
  ADD CONSTRAINT canonical_jobs_work_mode_ck
    CHECK (work_mode IS NULL OR work_mode IN ('remote', 'hybrid', 'on_site', 'unknown')),
  ADD CONSTRAINT canonical_jobs_employment_type_ck
    CHECK (
      employment_type IS NULL
      OR employment_type IN ('full_time', 'part_time', 'contract', 'internship', 'unknown')
    );
