-- D3-014: Applications participates in aggregate candidate export, deletion, and restore
-- reconciliation. Rows stay append-only for every caller except the privacy-authorized deletion
-- of the exact candidate, following the Billing and Trust owner boundaries. The Applications
-- schema never stores hiring outcomes, so an export lists only candidate-readable technical state.

DROP TRIGGER packets_immutable ON applications.packets;
CREATE TRIGGER packets_immutable
BEFORE UPDATE ON applications.packets
FOR EACH ROW EXECUTE FUNCTION applications.reject_append_only_mutation();

DROP TRIGGER history_immutable ON applications.history;
CREATE TRIGGER history_immutable
BEFORE UPDATE ON applications.history
FOR EACH ROW EXECUTE FUNCTION applications.reject_append_only_mutation();

DROP TRIGGER command_receipts_immutable ON applications.command_receipts;
CREATE TRIGGER command_receipts_immutable
BEFORE UPDATE ON applications.command_receipts
FOR EACH ROW EXECUTE FUNCTION applications.reject_append_only_mutation();

DROP TRIGGER approvals_delete_forbidden ON applications.approvals;
DROP TRIGGER attempts_delete_forbidden ON applications.attempts;
DROP TRIGGER outbox_delete_forbidden ON applications.outbox;

CREATE OR REPLACE FUNCTION applications.guard_candidate_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT privacy.current_candidate_deletion_authorized(OLD.owner_user_id) THEN
    RAISE EXCEPTION 'applications % is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER applications_candidate_delete_guard
BEFORE DELETE ON applications.applications
FOR EACH ROW EXECUTE FUNCTION applications.guard_candidate_delete();
CREATE TRIGGER packets_candidate_delete_guard
BEFORE DELETE ON applications.packets
FOR EACH ROW EXECUTE FUNCTION applications.guard_candidate_delete();
CREATE TRIGGER approvals_candidate_delete_guard
BEFORE DELETE ON applications.approvals
FOR EACH ROW EXECUTE FUNCTION applications.guard_candidate_delete();
CREATE TRIGGER attempts_candidate_delete_guard
BEFORE DELETE ON applications.attempts
FOR EACH ROW EXECUTE FUNCTION applications.guard_candidate_delete();
CREATE TRIGGER history_candidate_delete_guard
BEFORE DELETE ON applications.history
FOR EACH ROW EXECUTE FUNCTION applications.guard_candidate_delete();
CREATE TRIGGER command_receipts_candidate_delete_guard
BEFORE DELETE ON applications.command_receipts
FOR EACH ROW EXECUTE FUNCTION applications.guard_candidate_delete();
CREATE TRIGGER outbox_candidate_delete_guard
BEFORE DELETE ON applications.outbox
FOR EACH ROW EXECUTE FUNCTION applications.guard_candidate_delete();

-- Portable export section. Internal ownership identifiers, the duplicate-submit scope key, the
-- approval consent reference, and evidence fingerprints are deliberately omitted; packet field
-- values are the candidate's own answers and are exported as stored.
CREATE OR REPLACE FUNCTION applications.export_candidate_data(candidate_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, applications
AS $$
  SELECT jsonb_build_object(
    'applications', jsonb_build_object(
      'schemaVersion', 1,
      'applications', COALESCE((
        SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'id', application.id, 'canonicalJobId', application.canonical_job_id,
          'status', application.status, 'revision', application.revision,
          'currentPacketId', application.current_packet_id,
          'createdAt', application.created_at, 'updatedAt', application.updated_at
        )) ORDER BY application.created_at, application.id)
        FROM applications.applications application
        WHERE application.owner_user_id = candidate_user_id
      ), '[]'::jsonb),
      'packets', COALESCE((
        SELECT jsonb_agg(
          jsonb_strip_nulls(jsonb_build_object(
            'id', packet.id, 'applicationId', packet.application_id, 'version', packet.version,
            'packetHash', packet.packet_hash, 'jobRevision', packet.job_revision,
            'formAdapterId', packet.form_adapter_id, 'formVariantId', packet.form_variant_id,
            'formHash', packet.form_hash, 'resumeHash', packet.resume_hash,
            'coverLetterHash', packet.cover_letter_hash, 'createdAt', packet.created_at
          )) || jsonb_build_object('fields', packet.fields)
          ORDER BY packet.application_id, packet.version
        )
        FROM applications.packets packet
        WHERE packet.owner_user_id = candidate_user_id
      ), '[]'::jsonb),
      'approvals', COALESCE((
        SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'id', approval.id, 'packetId', approval.packet_id,
          'applicationId', approval.application_id, 'packetHash', approval.packet_hash,
          'acknowledgedFieldKeys', to_jsonb(approval.acknowledged_field_keys),
          'approvedAt', approval.approved_at, 'expiresAt', approval.expires_at,
          'invalidatedAt', approval.invalidated_at,
          'invalidationReason', approval.invalidation_reason
        )) ORDER BY approval.approved_at, approval.id)
        FROM applications.approvals approval
        WHERE approval.owner_user_id = candidate_user_id
      ), '[]'::jsonb),
      'attempts', COALESCE((
        SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'id', attempt.id, 'applicationId', attempt.application_id,
          'packetId', attempt.packet_id, 'sequence', attempt.sequence,
          'status', attempt.status, 'adapterId', attempt.adapter_id,
          'adapterVersion', attempt.adapter_version, 'startedAt', attempt.started_at,
          'dispatchedAt', attempt.dispatched_at, 'resolvedAt', attempt.resolved_at,
          'evidenceKind', attempt.evidence_kind,
          'evidenceObservedAt', attempt.evidence_observed_at,
          'evidenceProviderReference', attempt.evidence_provider_reference
        )) ORDER BY attempt.application_id, attempt.sequence)
        FROM applications.attempts attempt
        WHERE attempt.owner_user_id = candidate_user_id
      ), '[]'::jsonb),
      'history', COALESCE((
        SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'applicationId', event.application_id, 'seq', event.seq, 'kind', event.kind,
          'fromStatus', event.from_status, 'toStatus', event.to_status,
          'packetId', event.packet_id, 'attemptId', event.attempt_id,
          'reasonCode', event.reason_code, 'occurredAt', event.occurred_at
        )) ORDER BY event.application_id, event.seq)
        FROM applications.history event
        WHERE event.owner_user_id = candidate_user_id
      ), '[]'::jsonb)
    ),
    'audit', jsonb_build_object(
      'events', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'owner', 'applications', 'action', 'applications.' || event.kind,
          'resourceType', 'application', 'resourceId', event.application_id,
          'occurredAt', event.occurred_at
        ) ORDER BY event.occurred_at, event.application_id, event.seq)
        FROM applications.history event
        WHERE event.owner_user_id = candidate_user_id
      ), '[]'::jsonb)
    )
  )
$$;

-- Children are deleted before their parents; the current-packet reference is deferred, so packets
-- and applications may be removed together inside this one privacy-authorized transaction.
CREATE OR REPLACE FUNCTION applications.delete_candidate_data(
  candidate_user_id uuid,
  candidate_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, applications, privacy
AS $$
DECLARE
  applications_deleted integer;
  packets_deleted integer;
  attempts_deleted integer;
BEGIN
  IF NOT privacy.candidate_deletion_authorized(candidate_request_id, candidate_user_id) THEN
    RAISE EXCEPTION 'candidate deletion is not authorized' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('app.candidate_deletion_request_id', candidate_request_id::text, true);
  DELETE FROM applications.outbox WHERE owner_user_id = candidate_user_id;
  DELETE FROM applications.command_receipts WHERE owner_user_id = candidate_user_id;
  DELETE FROM applications.history WHERE owner_user_id = candidate_user_id;
  DELETE FROM applications.attempts WHERE owner_user_id = candidate_user_id;
  GET DIAGNOSTICS attempts_deleted = ROW_COUNT;
  DELETE FROM applications.approvals WHERE owner_user_id = candidate_user_id;
  DELETE FROM applications.packets WHERE owner_user_id = candidate_user_id;
  GET DIAGNOSTICS packets_deleted = ROW_COUNT;
  DELETE FROM applications.applications WHERE owner_user_id = candidate_user_id;
  GET DIAGNOSTICS applications_deleted = ROW_COUNT;
  RETURN jsonb_build_object(
    'owner', 'applications', 'applicationsDeleted', applications_deleted,
    'packetsDeleted', packets_deleted, 'attemptsDeleted', attempts_deleted
  );
END;
$$;

REVOKE ALL ON FUNCTION applications.guard_candidate_delete() FROM PUBLIC;
REVOKE ALL ON FUNCTION applications.export_candidate_data(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION applications.delete_candidate_data(uuid, uuid) FROM PUBLIC;
