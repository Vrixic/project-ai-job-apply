-- Stage independently fetched provider truth before it is allowed to mutate the catalog. The
-- staged projection is public provider data, never the candidate's page/DOM or UGC as source truth.
ALTER TABLE jobs.job_contribution_independent_verifications
  DROP CONSTRAINT job_contribution_independent_verifications_id_fkey,
  ALTER COLUMN job_id DROP NOT NULL,
  ALTER COLUMN source_id DROP NOT NULL,
  ADD COLUMN provider_observation jsonb;

UPDATE jobs.job_contribution_independent_verifications AS verification
SET provider_observation = jsonb_strip_nulls(jsonb_build_object(
  'provider', source.provider,
  'provenance', source.provenance,
  'companyName', company.display_name,
  'title', job.title,
  'locations', job.locations,
  'description', job.description,
  'sourceUrl', source.canonical_url,
  'observedAt', to_jsonb(verification.verified_at),
  'atsTenant', source.ats_tenant,
  'externalJobId', source.external_job_id,
  'employerRequisitionId', source.employer_requisition_id,
  'verifiedCompanyDomain', source.verified_company_domain,
  'department', job.department,
  'workMode', job.work_mode,
  'employmentType', job.employment_type,
  'datePosted', to_jsonb(source.date_posted),
  'applicationUrl', source.application_url,
  'structuredLocations', source.structured_locations,
  'validThrough', to_jsonb(source.valid_through),
  'adapterVersion', source.adapter_version
))
FROM jobs.canonical_jobs AS job
JOIN jobs.companies AS company ON company.id = job.company_id
JOIN jobs.job_sources AS source ON source.job_id = job.id
WHERE verification.job_id = job.id AND verification.source_id = source.id;

ALTER TABLE jobs.job_contribution_independent_verifications
  ALTER COLUMN provider_observation SET NOT NULL,
  ADD CONSTRAINT job_contribution_independent_verifications_catalog_identity_ck CHECK (
    (job_id IS NULL AND source_id IS NULL) OR (job_id IS NOT NULL AND source_id IS NOT NULL)
  ),
  ADD CONSTRAINT job_contribution_independent_verifications_observation_ck CHECK (
    jsonb_typeof(provider_observation) = 'object'
    AND octet_length(provider_observation::text) BETWEEN 2 AND 65536
  );

DROP INDEX jobs.job_contribution_independent_verifications_source_idx;
CREATE INDEX job_contribution_independent_verifications_source_idx
  ON jobs.job_contribution_independent_verifications (source_id, verified_at DESC, id)
  WHERE source_id IS NOT NULL;

DROP TRIGGER job_contribution_independent_verifications_append_only
  ON jobs.job_contribution_independent_verifications;
CREATE FUNCTION jobs.guard_job_contribution_verification_linkage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  candidate_user_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT owner_user_id INTO candidate_user_id
    FROM jobs.job_contributions WHERE id = OLD.contribution_id;
    IF candidate_user_id IS NULL
      OR NOT privacy.current_candidate_deletion_authorized(candidate_user_id) THEN
      RAISE EXCEPTION 'job contribution processing evidence is append-only' USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.job_id IS NOT NULL OR OLD.source_id IS NOT NULL
    OR NEW.job_id IS NULL OR NEW.source_id IS NULL
    OR NEW.id <> OLD.id OR NEW.contribution_id <> OLD.contribution_id
    OR NEW.normalization_id <> OLD.normalization_id OR NEW.provider <> OLD.provider
    OR NEW.page_variant <> OLD.page_variant
    OR NEW.canonical_source_url_sha256 <> OLD.canonical_source_url_sha256
    OR NEW.evidence_digest_sha256 <> OLD.evidence_digest_sha256
    OR NEW.verified_content_sha256 <> OLD.verified_content_sha256
    OR NEW.source_policy_version <> OLD.source_policy_version
    OR NEW.verified_at <> OLD.verified_at
    OR NEW.provider_observation <> OLD.provider_observation
    OR NEW.processing_policy_version <> OLD.processing_policy_version
    OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'job contribution verification linkage is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER job_contribution_independent_verifications_linkage_guard
BEFORE UPDATE OR DELETE ON jobs.job_contribution_independent_verifications
FOR EACH ROW EXECUTE FUNCTION jobs.guard_job_contribution_verification_linkage();

ALTER TABLE jobs.job_contribution_reconciliations
  ALTER COLUMN job_id DROP NOT NULL,
  ALTER COLUMN source_id DROP NOT NULL,
  ADD CONSTRAINT job_contribution_reconciliations_catalog_identity_ck CHECK (
    (job_id IS NULL AND source_id IS NULL) OR (job_id IS NOT NULL AND source_id IS NOT NULL)
  ),
  ADD CONSTRAINT job_contribution_reconciliations_applied_identity_ck CHECK (
    state <> 'applied' OR (job_id IS NOT NULL AND source_id IS NOT NULL)
  );

ALTER TABLE jobs.job_contribution_state_events
  DROP CONSTRAINT job_contribution_state_events_reason_ck,
  ADD CONSTRAINT job_contribution_state_events_reason_ck CHECK (
    reason_code IN (
      'normalization_complete', 'consent_not_current',
      'provider_temporarily_unavailable', 'provider_observation_mismatch',
      'provider_posting_closed', 'provider_probable_duplicate',
      'independent_verification_complete', 'trust_review_required',
      'trust_policy_rejected', 'trust_withdrawal', 'trust_takedown',
      'publication_gates_complete', 'publication_complete',
      'terminal_reconciliation_complete'
    )
  );

CREATE OR REPLACE FUNCTION jobs.guard_job_contribution_reconciliation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  candidate_user_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT owner_user_id INTO candidate_user_id
    FROM jobs.job_contributions WHERE id = OLD.contribution_id;
    IF candidate_user_id IS NULL
      OR NOT privacy.current_candidate_deletion_authorized(candidate_user_id) THEN
      RAISE EXCEPTION 'job contribution reconciliation is immutable' USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.state <> 'prepared' OR NEW.state <> 'applied'
    OR NEW.id <> OLD.id OR NEW.contribution_id <> OLD.contribution_id
    OR NEW.kind <> OLD.kind OR NEW.normalization_id <> OLD.normalization_id
    OR NEW.independent_verification_id <> OLD.independent_verification_id
    OR NEW.trust_decision_id <> OLD.trust_decision_id
    OR (OLD.job_id IS NOT NULL AND NEW.job_id <> OLD.job_id)
    OR (OLD.source_id IS NOT NULL AND NEW.source_id <> OLD.source_id)
    OR NEW.job_id IS NULL OR NEW.source_id IS NULL
    OR NEW.terminal_reason IS DISTINCT FROM OLD.terminal_reason
    OR NEW.processing_policy_version <> OLD.processing_policy_version
    OR NEW.capability_policy_version <> OLD.capability_policy_version
    OR NEW.capability_configuration_digest_sha256 <>
      OLD.capability_configuration_digest_sha256
    OR NEW.capability_evaluated_at <> OLD.capability_evaluated_at
    OR NEW.capability_expires_at <> OLD.capability_expires_at
    OR NEW.created_at <> OLD.created_at OR NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'invalid job contribution reconciliation transition' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
