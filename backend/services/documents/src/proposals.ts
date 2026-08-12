import type { ProfileFact } from "@ai-job-apply/api-contracts";
import type { NormalizedResumeBlock, NormalizedResumeDocument } from "./parsing/normalize.js";

export interface ResumeFactProposal {
  kind: ProfileFact["kind"];
  key: string;
  value: ProfileFact["value"];
  sensitivity: ProfileFact["sensitivity"];
  evidence: NonNullable<ProfileFact["evidence"]>;
}

const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu;
const skillsHeadingPattern = /^skills?(?:\s*&\s*(?:tools|technologies))?\s*[:|-]\s*/iu;
const prohibitedSkillPattern = /(?:sponsor|citizen|visa|veteran|disab|race|gender|criminal)/iu;

function evidence(
  document: NormalizedResumeDocument,
  block: NormalizedResumeBlock,
  startOffset: number,
  endOffset: number,
): NonNullable<ProfileFact["evidence"]> {
  return {
    supportingSpans: [
      {
        documentId: document.documentId,
        documentVersion: document.version,
        parserVersion: document.parserVersion,
        blockIndex: block.index,
        startOffset,
        endOffset,
        ...(block.page ? { page: block.page } : {}),
      },
    ],
  };
}

/** Conservative, deterministic extraction. Every output remains proposed until candidate action. */
export function extractResumeFactProposals(
  document: NormalizedResumeDocument,
): ResumeFactProposal[] {
  const proposals: ResumeFactProposal[] = [];
  const seen = new Set<string>();
  for (const block of document.blocks) {
    for (const match of block.text.matchAll(emailPattern)) {
      const value = match[0];
      const startOffset = match.index;
      const signature = `identity:email:${value.toLowerCase()}`;
      if (seen.has(signature)) continue;
      seen.add(signature);
      proposals.push({
        kind: "identity",
        key: "email",
        value,
        sensitivity: "confidential",
        evidence: evidence(document, block, startOffset, startOffset + value.length),
      });
    }

    const heading = skillsHeadingPattern.exec(block.text);
    if (!heading) continue;
    const list = block.text.slice(heading[0].length);
    for (const tokenMatch of list.matchAll(/[^,;|•\n]+/gu)) {
      const raw = tokenMatch[0];
      const leading = raw.length - raw.trimStart().length;
      const value = raw.trim();
      if (!value || value.length > 100 || prohibitedSkillPattern.test(value)) continue;
      const startOffset = heading[0].length + tokenMatch.index + leading;
      const signature = `skill:${value.toLocaleLowerCase("en-US")}`;
      if (seen.has(signature)) continue;
      seen.add(signature);
      proposals.push({
        kind: "skill",
        key: "skill",
        value,
        sensitivity: "standard",
        evidence: evidence(document, block, startOffset, startOffset + value.length),
      });
      if (proposals.length >= 100) return proposals;
    }
  }
  return proposals;
}
