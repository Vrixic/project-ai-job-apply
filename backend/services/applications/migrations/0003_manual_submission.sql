-- D3-018: a candidate who never used an adapter at all can still record a submission. Adds the
-- idempotency operation the manual-start command uses; the attempt/application state machines
-- already allow an attempt to begin as `taken_over` (see the 0001 dispatch/resolution checks), so
-- nothing else in the schema changes.

ALTER TABLE applications.command_receipts
  DROP CONSTRAINT IF EXISTS command_receipts_operation_check;
ALTER TABLE applications.command_receipts
  ADD CONSTRAINT command_receipts_operation_check CHECK (
    operation IN ('create_application', 'create_packet', 'approve', 'cancel', 'start_attempt',
      'start_manual_attempt', 'record_result', 'reconcile', 'takeover')
  );
