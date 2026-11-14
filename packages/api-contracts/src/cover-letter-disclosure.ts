/**
 * Exact versioned notice for an explicit cover-letter request. Changing its meaning requires a
 * new version and owner review. This is disclosure content, not provider activation authority.
 */
export const COVER_LETTER_DISCLOSURE_VERSION = "bedrock-cover-letter.v1" as const;
export const COVER_LETTER_DISCLOSURE_TEXT =
  "With your permission, we send your confirmed, non-restricted career facts and this job's text " +
  "to Amazon Web Services (Amazon Bedrock, in our own AWS account in the United States), where " +
  "Anthropic's Claude Sonnet 4.6 drafts this cover letter. AWS's published terms say it does not " +
  "use this content to train models or share it with the model provider, and do not list this " +
  "model among those for which AWS retains content; those terms can change. We keep the draft in " +
  "memory only and discard every copy within 30 minutes. You must review the draft before it can " +
  "be used. You can decline and write your own text.";
