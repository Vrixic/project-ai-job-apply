ALTER TABLE jobs.ingestion_checkpoints
  DROP CONSTRAINT ingestion_checkpoints_contract_ck;

ALTER TABLE jobs.ingestion_checkpoints
  ADD CONSTRAINT ingestion_checkpoints_contract_ck CHECK (
    schema_version = 1
    AND source_id ~ '^[a-z0-9][a-z0-9-]{2,63}$'
    AND adapter_version ~ '^[a-z0-9][a-z0-9._-]{2,99}$'
    AND revision BETWEEN 0 AND 9007199254740991
    AND attempt BETWEEN 1 AND 5
    AND withdrawal_inferred = false
    AND updated_at >= created_at
  );
