-- ADR-059 addendum 12: cover letters are drafted through Amazon Bedrock. The disclosure names the model,
-- so the notice version, provider and model move together. Rows created under the OpenAI notice stay
-- valid and immutable (guard_preparation_update already forbids rewriting them); new rows can only be
-- created under the Bedrock notice by the Gateway, whose insert relies on these column defaults.
ALTER TABLE applications.packet_preparations
  DROP CONSTRAINT packet_preparations_notice_version_check,
  DROP CONSTRAINT packet_preparations_provider_check,
  DROP CONSTRAINT packet_preparations_model_check,
  ALTER COLUMN provider SET DEFAULT 'bedrock',
  ALTER COLUMN model SET DEFAULT 'us.anthropic.claude-sonnet-4-6',
  ADD CONSTRAINT packet_preparations_notice_provider_model_ck CHECK (
    (notice_version = 'openai-cover-letter.v1' AND provider = 'openai' AND model = 'gpt-6-luna')
    OR (notice_version = 'bedrock-cover-letter.v1' AND provider = 'bedrock'
      AND model = 'us.anthropic.claude-sonnet-4-6')
  );
