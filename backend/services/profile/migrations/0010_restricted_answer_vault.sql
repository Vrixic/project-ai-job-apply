-- Restricted answer vault (ADR-010, D3-001). Each entry is one reusable field key + optional
-- context; its versions are append-only and immutable, matching profile_fact_versions, so a
-- corrected or deleted answer can never be resurrected by a queued workflow holding an older
-- version. The value itself is never stored in the clear: only a KMS ciphertext, its key id, and
-- the algorithm used. The application layer, not this schema, decides which fields are eligible.

CREATE TABLE IF NOT EXISTS profile.restricted_answers (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  field_key text NOT NULL CHECK (char_length(field_key) BETWEEN 1 AND 120 AND field_key ~ '\S'),
  context text CHECK (context IS NULL OR (char_length(context) BETWEEN 1 AND 120 AND context ~ '\S')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One entry per candidate/field/context: coalesce so two NULL-context entries still collide,
-- matching matchVaultEntry's "an entry without context matches only context-free questions".
CREATE UNIQUE INDEX IF NOT EXISTS restricted_answers_owner_field_context_key
  ON profile.restricted_answers(user_id, field_key, coalesce(context, ''));

CREATE TABLE IF NOT EXISTS profile.restricted_answer_versions (
  answer_id uuid NOT NULL REFERENCES profile.restricted_answers(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  value_type text NOT NULL CHECK (value_type IN ('string', 'text', 'boolean', 'date', 'decimal', 'enum')),
  sensitivity text NOT NULL CHECK (sensitivity IN ('confidential', 'restricted')),
  -- KMS EncryptCommand output for a plaintext under its 4096-byte limit; restricted answers are
  -- short scalars, never files. No plaintext hash is stored: several restricted answers have a
  -- tiny value space (yes/no, a short enum), so a hash would let a holder of the ciphertext row
  -- brute-force which value it is without ever calling KMS.
  ciphertext bytea NOT NULL CHECK (octet_length(ciphertext) BETWEEN 1 AND 4096),
  kms_key_id text NOT NULL CHECK (char_length(kms_key_id) BETWEEN 1 AND 300 AND kms_key_id ~ '\S'),
  encryption_algorithm text NOT NULL CHECK (encryption_algorithm IN ('SYMMETRIC_DEFAULT')),
  state text NOT NULL CHECK (state IN ('active', 'deleted')),
  source_reference text NOT NULL CHECK (char_length(source_reference) BETWEEN 1 AND 200 AND source_reference ~ '\S'),
  confirmed_at timestamptz NOT NULL,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (answer_id, version),
  CHECK (expires_at IS NULL OR expires_at > confirmed_at)
);
CREATE INDEX IF NOT EXISTS restricted_answer_versions_latest_idx
  ON profile.restricted_answer_versions(answer_id, version DESC);

CREATE OR REPLACE FUNCTION profile.reject_restricted_answer_version_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'restricted answer versions are immutable'
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS restricted_answer_versions_reject_update
  ON profile.restricted_answer_versions;
CREATE TRIGGER restricted_answer_versions_reject_update
BEFORE UPDATE ON profile.restricted_answer_versions
FOR EACH ROW
EXECUTE FUNCTION profile.reject_restricted_answer_version_update();

-- ---- Candidate export and deletion participation (metadata only; the ciphertext is opaque
-- without the cipher, so it is deliberately omitted from the export rather than included as a
-- meaningless blob. Decrypting into the export is a separate, tracked follow-up.)

CREATE OR REPLACE FUNCTION profile.export_candidate_data(candidate_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, identity, platform, profile
AS $$
  SELECT jsonb_build_object(
    'candidate', jsonb_strip_nulls(jsonb_build_object(
      'email', (
        SELECT email FROM identity.external_identities
        WHERE user_id = candidate_user_id AND email IS NOT NULL
        ORDER BY last_seen_at DESC LIMIT 1
      ),
      'createdAt', candidate.created_at,
      'connectedAccounts', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'provider', 'managed_oidc',
          'linkedAt', created_at,
          'lastSeenAt', last_seen_at
        ) ORDER BY created_at, issuer)
        FROM identity.external_identities
        WHERE user_id = candidate_user_id
      ), '[]'::jsonb)
    )),
    'profile', jsonb_build_object(
      'preferences', (
        SELECT preferences || jsonb_build_object('version', version, 'updatedAt', updated_at)
        FROM profile.job_preferences WHERE user_id = candidate_user_id
      ),
      'facts', COALESCE((
        SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'id', fact.id,
          'version', version.version,
          'kind', version.kind,
          'key', version.fact_key,
          'value', version.fact_value,
          'verification', version.verification,
          'availability', version.availability_state,
          'sensitivity', version.sensitivity,
          'sourceType', version.source_type,
          'sourceReference', version.source_reference,
          'effectiveFrom', version.effective_from,
          'effectiveTo', version.effective_to,
          'createdAt', fact.created_at,
          'updatedAt', version.created_at
        )) ORDER BY fact.created_at, fact.id)
        FROM profile.profile_facts AS fact
        JOIN LATERAL (
          SELECT * FROM profile.profile_fact_versions
          WHERE fact_id = fact.id ORDER BY version DESC LIMIT 1
        ) AS version ON true
        WHERE fact.user_id = candidate_user_id
      ), '[]'::jsonb),
      'restrictedAnswers', COALESCE((
        SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'id', answer.id,
          'fieldKey', answer.field_key,
          'context', answer.context,
          'version', version.version,
          'valueType', version.value_type,
          'sensitivity', version.sensitivity,
          'state', version.state,
          'confirmedAt', version.confirmed_at,
          'expiresAt', version.expires_at,
          'createdAt', answer.created_at
        )) ORDER BY answer.created_at, answer.id)
        FROM profile.restricted_answers AS answer
        JOIN LATERAL (
          SELECT * FROM profile.restricted_answer_versions
          WHERE answer_id = answer.id ORDER BY version DESC LIMIT 1
        ) AS version ON true
        WHERE answer.user_id = candidate_user_id
      ), '[]'::jsonb),
      'contributionConsents', COALESCE((
        SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'consentId', consent.consent_id,
          'purpose', consent.purpose,
          'client', consent.client,
          'documentVersion', consent.document_version,
          'policyVersion', consent.policy_version,
          'state', consent.action,
          'grantedAt', consent.granted_at,
          'expiresAt', consent.expires_at,
          'recordedAt', consent.recorded_at,
          'replacementConsentId', consent.replacement_consent_id
        )) ORDER BY consent.recorded_at, consent.id)
        FROM profile.ugc_contribution_consents AS consent
        WHERE consent.owner_user_id = candidate_user_id
      ), '[]'::jsonb)
    ),
    'audit', jsonb_build_object(
      'events', COALESCE((
        SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'owner', CASE
            WHEN action LIKE 'identity.%' THEN 'identity'
            ELSE 'profile'
          END,
          'action', action,
          'resourceType', resource_type,
          'resourceId', resource_id,
          'occurredAt', occurred_at
        )) ORDER BY occurred_at, id)
        FROM platform.audit_events WHERE user_id = candidate_user_id
      ), '[]'::jsonb)
    )
  )
  FROM identity.users AS candidate
  WHERE candidate.id = candidate_user_id
$$;

CREATE OR REPLACE FUNCTION profile.delete_candidate_data(
  candidate_user_id uuid,
  candidate_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, platform, privacy, profile
AS $$
DECLARE
  preferences_deleted integer;
  facts_deleted integer;
  contribution_consents_deleted integer;
  restricted_answers_deleted integer;
BEGIN
  IF NOT privacy.candidate_deletion_authorized(candidate_request_id, candidate_user_id) THEN
    RAISE EXCEPTION 'candidate deletion is not authorized' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('app.candidate_deletion_request_id', candidate_request_id::text, true);

  DELETE FROM profile.ugc_contribution_consents
  WHERE owner_user_id = candidate_user_id;
  GET DIAGNOSTICS contribution_consents_deleted = ROW_COUNT;

  DELETE FROM platform.idempotency_keys
  WHERE user_id = candidate_user_id
    AND scope IN (
      'ugc_contribution_consent.grant',
      'ugc_contribution_consent.revoked',
      'ugc_contribution_consent.superseded'
    );

  DELETE FROM profile.restricted_answers WHERE user_id = candidate_user_id;
  GET DIAGNOSTICS restricted_answers_deleted = ROW_COUNT;

  DELETE FROM profile.job_preferences WHERE user_id = candidate_user_id;
  GET DIAGNOSTICS preferences_deleted = ROW_COUNT;
  DELETE FROM profile.profile_facts WHERE user_id = candidate_user_id;
  GET DIAGNOSTICS facts_deleted = ROW_COUNT;
  DELETE FROM profile.resume_fact_imports WHERE user_id = candidate_user_id;
  DELETE FROM platform.audit_events
  WHERE user_id = candidate_user_id AND action NOT LIKE 'profile.account-deletion.%';
  RETURN jsonb_build_object(
    'owner', 'profile',
    'preferencesDeleted', preferences_deleted,
    'factsDeleted', facts_deleted,
    'contributionConsentsDeleted', contribution_consents_deleted,
    'restrictedAnswersDeleted', restricted_answers_deleted
  );
END;
$$;

REVOKE ALL ON FUNCTION profile.export_candidate_data(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION profile.delete_candidate_data(uuid, uuid) FROM PUBLIC;
