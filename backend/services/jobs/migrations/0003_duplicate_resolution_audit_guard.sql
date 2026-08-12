CREATE FUNCTION jobs.reject_duplicate_resolution_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'duplicate resolution events are append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER duplicate_resolution_events_append_only
BEFORE UPDATE OR DELETE ON jobs.duplicate_resolution_events
FOR EACH ROW EXECUTE FUNCTION jobs.reject_duplicate_resolution_event_mutation();
