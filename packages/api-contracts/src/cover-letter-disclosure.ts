/**
 * Exact versioned notice for an explicit cover-letter request. Changing its meaning requires a
 * new version and owner review. This is disclosure content, not provider activation authority.
 */
export const COVER_LETTER_DISCLOSURE_VERSION = "openai-cover-letter.v1" as const;
export const COVER_LETTER_DISCLOSURE_TEXT =
  "With your permission, we send your confirmed, non-restricted career facts and this job's text " +
  "to OpenAI (gpt-6-luna) to draft this cover letter. OpenAI does not use API content for training " +
  "by default. Provider abuse-monitoring logs may retain content for up to 30 days, with longer " +
  "legal or safety exceptions; temporary prompt caching may also retain data. You must review " +
  "the draft before it can be used. You can decline and write your own text.";
