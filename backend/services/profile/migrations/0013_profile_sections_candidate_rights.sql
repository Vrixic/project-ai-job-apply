-- Structured Profile candidate rights (ADR-052): export the new sections and erase them on account
-- deletion. Forward-only replacement of the 0010 export and deletion functions.

-- Structured Profile export (ADR-052): the candidate-readable latest version of each saved entry.
CREATE OR REPLACE FUNCTION profile.export_candidate_entries(candidate_user_id uuid, entry_section text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, profile
AS $$
  SELECT COALESCE(jsonb_agg(
    jsonb_strip_nulls(
      jsonb_build_object('id', entry.id)
      || version.content
      || jsonb_build_object(
        'version', version.version,
        'origin', version.origin,
        'importId', version.import_id,
        'createdAt', entry.created_at,
        'updatedAt', version.created_at
      )
      || CASE
        WHEN entry_section = 'applicationAnswer'
          THEN jsonb_build_object('questionKey', entry.natural_key)
        ELSE jsonb_build_object('displayOrder', entry.display_order)
      END
    ) ORDER BY entry.display_order, entry.created_at, entry.id
  ), '[]'::jsonb)
  FROM profile.entries AS entry
  JOIN LATERAL (
    SELECT * FROM profile.entry_versions
    WHERE entry_id = entry.id ORDER BY version DESC LIMIT 1
  ) AS version ON true
  WHERE entry.user_id = candidate_user_id AND entry.section = entry_section
$$;

REVOKE ALL ON FUNCTION profile.export_candidate_entries(uuid, text) FROM PUBLIC;

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
      'personal', (
        SELECT jsonb_strip_nulls(version.content || jsonb_build_object(
          'version', version.version,
          'origin', version.origin,
          'importId', version.import_id,
          'createdAt', (
            SELECT first_version.created_at FROM profile.personal_versions AS first_version
            WHERE first_version.user_id = candidate_user_id AND first_version.version = 1
          ),
          'updatedAt', version.created_at
        ))
        FROM profile.personal_versions AS version
        WHERE version.user_id = candidate_user_id
        ORDER BY version.version DESC
        LIMIT 1
      ),
      'education', profile.export_candidate_entries(candidate_user_id, 'education'),
      'workExperience', profile.export_candidate_entries(candidate_user_id, 'workExperience'),
      'skills', profile.export_candidate_entries(candidate_user_id, 'skill'),
      'applicationAnswers', profile.export_candidate_entries(candidate_user_id, 'applicationAnswer'),
      'importDrafts', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', draft.id,
          'importId', draft.import_id,
          'section', draft.section,
          'values', draft.draft_values,
          'createdAt', draft.created_at
        ) ORDER BY draft.created_at, draft.id)
        FROM profile.import_drafts AS draft
        WHERE draft.user_id = candidate_user_id
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

  -- Structured Profile (ADR-052): erase the records, their versions and every replay record that
  -- still carries their text.
  DELETE FROM profile.entries WHERE user_id = candidate_user_id;
  DELETE FROM profile.personal_versions WHERE user_id = candidate_user_id;
  DELETE FROM profile.import_drafts WHERE user_id = candidate_user_id;
  DELETE FROM platform.idempotency_keys
  WHERE user_id = candidate_user_id
    AND (
      scope LIKE 'profile.entry.%'
      OR scope LIKE 'profile.personal.%'
      OR scope LIKE 'profile.draft.%'
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
