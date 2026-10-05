-- ADR-038 / D3-064: document fields retain exact artifact digests only, never material text.
-- Validate existing rows without rewriting append-only packets. Any incompatible legacy row
-- blocks the migration and needs an explicit retention/disposition review; no silent backfill.
ALTER TABLE applications.packets
  ADD CONSTRAINT packets_document_field_hashes_ck CHECK (
    jsonb_path_query_array(fields,
      '$[*] ? (@.fieldKey == "documents.cover_letter" && @.value != null).value')
      <@ jsonb_build_array(cover_letter_hash)
    AND jsonb_path_query_array(fields,
      '$[*] ? (@.fieldKey == "documents.resume" && @.value != null).value')
      <@ jsonb_build_array(resume_hash)
  );
