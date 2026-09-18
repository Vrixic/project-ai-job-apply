import type { ApplicationFormModel, FormField } from "./form-model.js";

interface Synonym {
  key: string;
  /** Label patterns. An exact whole-label match scores 1.0; a partial match scores 0.8. */
  patterns: RegExp[];
  types?: FormField["type"][];
}

/**
 * Provider-neutral label-to-taxonomy synonyms. Sensitive taxonomy keys are mapped on purpose so a
 * matching control is recognized as sensitive and routed to review, never so it can be filled
 * silently.
 */
const SYNONYMS: readonly Synonym[] = [
  {
    key: "identity.legal_name.first",
    patterns: [/^(?:legal\s+)?first\s+name$/u, /\bgiven\s+name\b/u],
  },
  { key: "identity.legal_name.middle", patterns: [/^middle\s+(?:name|initial)$/u] },
  {
    key: "identity.legal_name.last",
    patterns: [/^(?:legal\s+)?last\s+name$/u, /\b(?:family\s+name|surname)\b/u],
  },
  { key: "identity.preferred_name", patterns: [/\bpreferred\s+(?:first\s+)?name\b/u] },
  { key: "contact.email", patterns: [/^e-?mail(?:\s+address)?$/u, /\be-?mail\b/u] },
  {
    key: "contact.phone",
    patterns: [
      /^(?:mobile\s+|phone\s+|telephone\s+)?(?:phone|mobile|telephone)(?:\s+number)?$/u,
      /\b(?:phone|mobile|telephone)\b/u,
    ],
  },
  {
    key: "contact.address.line1",
    patterns: [/^(?:street\s+)?address(?:\s+line)?(?:\s+1)?$/u, /\bstreet\b/u],
  },
  { key: "contact.address.city", patterns: [/^city$/u] },
  {
    key: "contact.address.region",
    patterns: [/^(?:state|province|region)(?:\s*\/\s*(?:province|region))?$/u],
  },
  {
    key: "contact.address.postal_code",
    patterns: [/^(?:zip|postal)(?:\s*\/?\s*(?:postal\s+)?code)?$/u],
  },
  { key: "links.linkedin", patterns: [/\blinkedin\b/u] },
  { key: "links.github", patterns: [/\bgithub\b/u] },
  {
    key: "links.portfolio",
    patterns: [/\b(?:portfolio|personal\s+(?:website|site|url)|website)\b/u],
  },
  { key: "employment.current_company", patterns: [/\bcurrent\s+(?:company|employer)\b/u] },
  {
    key: "employment.current_title",
    patterns: [/\bcurrent\s+(?:job\s+)?(?:title|position|role)\b/u],
  },
  { key: "education.school", patterns: [/^(?:school|university|college)(?:\s+name)?$/u] },
  { key: "education.degree", patterns: [/^degree(?:\s+type)?$/u] },
  { key: "education.field", patterns: [/\b(?:field\s+of\s+study|major|discipline)\b/u] },
  { key: "education.graduation_date", patterns: [/\bgraduat\w*\b/u] },
  { key: "job.notice_period", patterns: [/\bnotice\s+period\b/u] },
  {
    key: "job.available_start_date",
    patterns: [/\b(?:available|earliest)\b.*\bstart\b/u, /\bstart\s+date\b/u],
  },
  {
    key: "job.salary_expectation",
    patterns: [
      /\b(?:salary|compensation|pay)\s+(?:expectation|requirement)s?\b/u,
      /\bdesired\s+(?:salary|pay)\b/u,
    ],
  },
  { key: "job.relocation", patterns: [/\brelocat\w*\b/u] },
  { key: "job.remote_preference", patterns: [/\bremote\b/u] },
  {
    key: "authorization.us_authorized",
    patterns: [
      /\b(?:legally\s+)?(?:authori[sz]ed|eligible)\s+to\s+work\b/u,
      /\bwork\s+authori[sz]ation\b/u,
    ],
  },
  { key: "authorization.sponsorship_required", patterns: [/\bsponsor\w*\b/u] },
  { key: "authorization.export_control", patterns: [/\bexport\s+control\b/u] },
  { key: "demographic.gender", patterns: [/\bgender\b/u] },
  { key: "demographic.race_ethnicity", patterns: [/\b(?:race|ethnic\w*)\b/u] },
  { key: "demographic.veteran", patterns: [/\bveteran\b/u] },
  { key: "demographic.disability", patterns: [/\bdisabilit\w*\b/u] },
  { key: "documents.resume", patterns: [/\b(?:resume|cv|curriculum)\b/u], types: ["file"] },
  { key: "documents.cover_letter", patterns: [/\bcover\s+letter\b/u] },
  {
    key: "questions.why_company",
    patterns: [/\bwhy\b.*\b(?:want|interested|join|us|this\s+(?:company|role))\b/u],
  },
  {
    key: "attestation.truthful",
    patterns: [/\b(?:certify|attest|true\s+and\s+(?:correct|accurate)|acknowledge)\b/u],
    types: ["checkbox"],
  },
  { key: "signature.electronic", patterns: [/\b(?:e-?signature|signature|sign\s+here)\b/u] },
];

export interface FieldMapping {
  ref: string;
  /** Null when no taxonomy key matched with enough confidence. */
  fieldKey: string | null;
  confidence: number;
  reason: "matched" | "unmapped" | "ambiguous";
}

function normalize(label: string): string {
  return label
    .toLowerCase()
    .replace(/[*:?]+/gu, " ")
    .replace(/\(.*?\)/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function matchOne(field: FormField): { key: string; confidence: number } | null {
  const label = normalize(field.label || field.name);
  const name = normalize(field.name.replace(/[_\-[\]]+/gu, " "));
  let best: { key: string; confidence: number } | null = null;
  for (const synonym of SYNONYMS) {
    if (synonym.types && !synonym.types.includes(field.type)) continue;
    for (const pattern of synonym.patterns) {
      for (const text of [label, name]) {
        const match = pattern.exec(text);
        if (!match) continue;
        const confidence = match[0].length === text.length ? 1 : 0.8;
        if (!best || confidence > best.confidence) best = { key: synonym.key, confidence };
      }
    }
  }
  return best;
}

/**
 * Maps form controls to taxonomy keys. A key claimed by more than one control is ambiguous and
 * mapped to none: the candidate decides, the SDK never picks.
 */
export function mapFormFields(form: ApplicationFormModel): FieldMapping[] {
  const matches = form.fields.map((field) => ({ field, match: matchOne(field) }));
  const claims = new Map<string, number>();
  for (const { match } of matches) {
    if (match) claims.set(match.key, (claims.get(match.key) ?? 0) + 1);
  }
  return matches.map(({ field, match }): FieldMapping => {
    if (!match) return { ref: field.ref, fieldKey: null, confidence: 0, reason: "unmapped" };
    if ((claims.get(match.key) ?? 0) > 1) {
      return { ref: field.ref, fieldKey: null, confidence: 0, reason: "ambiguous" };
    }
    return { ref: field.ref, fieldKey: match.key, confidence: match.confidence, reason: "matched" };
  });
}
