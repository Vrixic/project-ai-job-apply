/**
 * Reusable Application answers (ADR-052). A saved answer is matched to a later question only by
 * the exact normalized question key. Restricted questions never enter the general Profile; they
 * stay in the ADR-010 restricted-answer vault with mandatory review.
 */

/** Lowercases, trims, collapses whitespace and strips trailing punctuation and a leading list marker. */
export function normalizeQuestionKey(question: string): string {
  return question
    .normalize("NFKC")
    .toLowerCase()
    .replace(/^\s*(?:[-*•]|\d{1,2}[.)])\s+/u, "")
    .replace(/\s+/gu, " ")
    .replace(/[\s?!.:;,]+$/u, "")
    .trim();
}

/**
 * Categories mirror the restricted entries of `data/taxonomies/application-fields.v1.json`
 * (authorization, disclosures, demographics) plus adjacent legal and protected-class topics.
 * The guard is deliberately broad: a false positive sends the candidate to the vault, while a
 * false negative would store a restricted answer in the general Profile.
 */
const RESTRICTED_PATTERNS: ReadonlyArray<{ category: string; pattern: RegExp }> = [
  {
    category: "work_authorization",
    pattern:
      /\b(?:authori[sz]ed|authori[sz]ation|eligible|eligibility|right)\b.{0,40}\b(?:work|employ)|\b(?:work|employment)\b.{0,40}\b(?:authori[sz]ation|permit|eligib)|\bvisa\b|\bcitizen(?:ship)?\b|\bgreen\s*card\b|\bpermanent\s+resident\b|\bimmigration\b|\bwork\s+permit\b|\bi-?9\b|\bh-?1b\b|\bopt\b|\bstem\s+opt\b/iu,
  },
  {
    category: "sponsorship",
    pattern: /\bsponsor(?:ship|ed)?\b/iu,
  },
  {
    category: "export_control",
    pattern:
      /\bexport\s+(?:control|controlled)\b|\bitar\b|\bear\b.{0,20}\bexport|\bsecurity\s+clearance\b|\bclearance\b/iu,
  },
  {
    category: "legal_disclosure",
    pattern:
      /\bnon-?\s?compete\b|\bnon-?\s?solicit|\bconflict\s+of\s+interest\b|\bcriminal\b|\bconvict(?:ed|ion)?\b|\bfelony\b|\bmisdemeanor\b|\barrest(?:ed)?\b|\bbackground\s+check\b|\blawsuit\b|\bgarnish/iu,
  },
  {
    category: "demographic",
    pattern:
      /\b(?:gender|sex|race|racial|ethnic(?:ity)?|hispanic|latino|latina|latinx|veteran|military\s+status|protected\s+veteran|disabilit(?:y|ies)|disabled|sexual\s+orientation|lgbtq?\+?|transgender|pronouns?|religio(?:n|us)|marital|pregnan|date\s+of\s+birth|\bage\b|birth\s*date|ssn|social\s+security|national\s+origin)\b/iu,
  },
  {
    category: "health_or_compensation_history",
    pattern:
      /\bmedical\b|\bhealth\s+(?:condition|status)\b|\bsalary\s+history\b|\bcurrent\s+(?:salary|compensation)\b|\bprevious\s+(?:salary|compensation)\b/iu,
  },
];

export type RestrictedQuestionCategory = (typeof RESTRICTED_PATTERNS)[number]["category"];

/**
 * Returns the matched restricted category, or undefined when the text looks general. Text that is
 * empty after normalization is treated as restricted because it cannot be classified.
 */
export function restrictedQuestionCategory(
  question: string,
): RestrictedQuestionCategory | undefined {
  const normalized = normalizeQuestionKey(question);
  if (normalized.length === 0) return "unclassifiable";
  for (const { category, pattern } of RESTRICTED_PATTERNS) {
    if (pattern.test(normalized)) return category;
  }
  return undefined;
}

export function isRestrictedQuestion(question: string): boolean {
  return restrictedQuestionCategory(question) !== undefined;
}
