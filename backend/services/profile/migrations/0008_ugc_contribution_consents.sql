CREATE TABLE profile.ugc_contribution_consents (
  id uuid PRIMARY KEY,
  consent_id uuid NOT NULL,
  owner_user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  purpose text NOT NULL,
  client text NOT NULL,
  document_version text NOT NULL,
  policy_version text NOT NULL,
  preview_payload_sha256 text NOT NULL,
  action text NOT NULL,
  granted_at timestamptz NOT NULL,
  expires_at timestamptz,
  recorded_at timestamptz NOT NULL,
  supersedes_record_id uuid REFERENCES profile.ugc_contribution_consents(id),
  replacement_consent_id uuid,
  CONSTRAINT ugc_contribution_consents_purpose_ck CHECK (purpose = 'ugc_contribution'),
  CONSTRAINT ugc_contribution_consents_client_ck CHECK (client = 'extension'),
  CONSTRAINT ugc_contribution_consents_document_version_ck
    CHECK (document_version ~ '^[a-z0-9][a-z0-9._-]{2,99}$'),
  CONSTRAINT ugc_contribution_consents_policy_version_ck
    CHECK (policy_version ~ '^[a-z0-9][a-z0-9._-]{2,99}$'),
  CONSTRAINT ugc_contribution_consents_preview_digest_ck
    CHECK (preview_payload_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT ugc_contribution_consents_action_ck
    CHECK (action IN ('granted', 'revoked', 'superseded')),
  CONSTRAINT ugc_contribution_consents_time_ck
    CHECK (recorded_at >= granted_at AND (expires_at IS NULL OR expires_at > granted_at)),
  CONSTRAINT ugc_contribution_consents_shape_ck CHECK (
    (action = 'granted' AND id = consent_id AND supersedes_record_id IS NULL AND
      replacement_consent_id IS NULL AND recorded_at = granted_at) OR
    (action = 'revoked' AND id <> consent_id AND supersedes_record_id IS NOT NULL AND
      replacement_consent_id IS NULL) OR
    (action = 'superseded' AND id <> consent_id AND supersedes_record_id IS NOT NULL AND
      replacement_consent_id IS NOT NULL AND replacement_consent_id <> consent_id)
  )
);

CREATE UNIQUE INDEX ugc_contribution_consents_grant_uq
  ON profile.ugc_contribution_consents(consent_id)
  WHERE action = 'granted';
CREATE UNIQUE INDEX ugc_contribution_consents_supersedes_uq
  ON profile.ugc_contribution_consents(supersedes_record_id)
  WHERE supersedes_record_id IS NOT NULL;
CREATE INDEX ugc_contribution_consents_owner_recorded_idx
  ON profile.ugc_contribution_consents(owner_user_id, recorded_at DESC, id DESC);
CREATE INDEX ugc_contribution_consents_current_idx
  ON profile.ugc_contribution_consents(consent_id, recorded_at DESC, id DESC);

CREATE FUNCTION profile.validate_ugc_contribution_consent_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  previous_record profile.ugc_contribution_consents%ROWTYPE;
  replacement_record profile.ugc_contribution_consents%ROWTYPE;
BEGIN
  IF NEW.action = 'granted' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO previous_record
  FROM profile.ugc_contribution_consents
  WHERE id = NEW.supersedes_record_id
  FOR UPDATE;

  IF NOT FOUND OR previous_record.consent_id <> NEW.consent_id OR
    previous_record.owner_user_id <> NEW.owner_user_id OR
    previous_record.purpose <> NEW.purpose OR previous_record.client <> NEW.client OR
    previous_record.document_version <> NEW.document_version OR
    previous_record.policy_version <> NEW.policy_version OR
    previous_record.preview_payload_sha256 <> NEW.preview_payload_sha256 OR
    previous_record.granted_at <> NEW.granted_at OR
    previous_record.expires_at IS DISTINCT FROM NEW.expires_at OR
    EXISTS (
      SELECT 1 FROM profile.ugc_contribution_consents
      WHERE supersedes_record_id = previous_record.id
    )
  THEN
    RAISE EXCEPTION 'UGC contribution consent transition is invalid';
  END IF;

  IF NEW.action = 'superseded' THEN
    SELECT * INTO replacement_record
    FROM profile.ugc_contribution_consents
    WHERE consent_id = NEW.replacement_consent_id AND action = 'granted';
    IF NOT FOUND OR replacement_record.owner_user_id <> NEW.owner_user_id OR
      EXISTS (
        SELECT 1 FROM profile.ugc_contribution_consents
        WHERE supersedes_record_id = replacement_record.id
      )
    THEN
      RAISE EXCEPTION 'UGC contribution replacement consent is invalid';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER ugc_contribution_consents_validate_insert
BEFORE INSERT ON profile.ugc_contribution_consents
FOR EACH ROW EXECUTE FUNCTION profile.validate_ugc_contribution_consent_insert();

CREATE FUNCTION profile.reject_ugc_contribution_consent_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'UGC contribution consent records are append-only';
END;
$$;

CREATE TRIGGER ugc_contribution_consents_reject_update
BEFORE UPDATE ON profile.ugc_contribution_consents
FOR EACH ROW EXECUTE FUNCTION profile.reject_ugc_contribution_consent_mutation();
