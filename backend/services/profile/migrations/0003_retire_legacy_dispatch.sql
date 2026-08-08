DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM platform.outbox_events
    WHERE dispatch_target = 'temporal'
      AND published_at IS NULL
  ) THEN
    RAISE EXCEPTION 'cannot retire legacy workflow dispatch with unpublished rows';
  END IF;
END
$$;

ALTER TABLE platform.outbox_events
  ALTER COLUMN dispatch_target SET DEFAULT 'lambda_durable',
  DROP CONSTRAINT outbox_events_dispatch_target_check;

UPDATE platform.outbox_events
SET dispatch_target = 'retired_legacy'
WHERE dispatch_target = 'temporal'
  AND published_at IS NOT NULL;

ALTER TABLE platform.outbox_events
  ADD CONSTRAINT outbox_events_dispatch_target_check
    CHECK (dispatch_target IN ('retired_legacy', 'lambda_durable'));
