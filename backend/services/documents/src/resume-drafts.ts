import type { NormalizedResumeBlock, NormalizedResumeDocument } from "./parsing/normalize.js";

/**
 * Resume import as drafts (ADR-052, D3.1-006). A parsed resume becomes draft Personal, Education,
 * Work experience and Skills values that the candidate reviews, edits and saves; none of them is a
 * profile record. Extraction is deterministic and conservative: a value is produced only when its
 * text appears in the resume, and an entry whose required fields cannot be read is skipped rather
 * than guessed. Month-precision dates become the first of the month; year-only dates become the
 * first or last day of the year (start or end), which the candidate sees and can correct.
 */

export type ResumeDraftSection = "personal" | "education" | "workExperience" | "skill";

export interface ResumeDraft {
  section: ResumeDraftSection;
  values: Record<string, unknown>;
}

export const RESUME_DRAFT_LIMITS = Object.freeze({
  education: 20,
  workExperience: 30,
  skill: 100,
});

type Heading = "experience" | "education" | "skills" | "other";

const HEADINGS: ReadonlyArray<{ kind: Heading; pattern: RegExp }> = [
  {
    kind: "experience",
    pattern:
      /^(?:professional |work |relevant |employment |career |industry )?(?:experience|history)(?: history)?$/iu,
  },
  { kind: "experience", pattern: /^employment$/iu },
  {
    kind: "education",
    pattern: /^(?:education(?: (?:and|&) (?:training|certifications?))?|academic background)$/iu,
  },
  {
    kind: "skills",
    pattern:
      /^(?:(?:technical|core|key|professional) )?(?:skills|competencies|technologies)(?: (?:and|&) (?:tools|technologies|competencies))?$/iu,
  },
  {
    kind: "other",
    pattern:
      /^(?:summary|profile|objective|projects?|certifications?|awards?|publications?|volunteer(?:ing)?(?: experience)?|interests|languages|references|honors|activities|leadership|about me|professional summary|patents)$/iu,
  },
];

const MONTHS: Readonly<Record<string, string>> = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dec: "12",
};
const MONTH =
  "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
const POINT = `(?:${MONTH}\\s+(?:19|20)\\d{2}|\\d{1,2}/(?:19|20)\\d{2}|(?:19|20)\\d{2})`;
const RANGE = new RegExp(
  `(${POINT})\\s*(?:-|\\u2013|\\u2014|to)\\s*(${POINT}|present|current|now|ongoing)`,
  "iu",
);
const SINGLE_POINT = new RegExp(`(${MONTH}\\s+(?:19|20)\\d{2}|\\d{1,2}/(?:19|20)\\d{2})`, "iu");
const BULLET = /^[•\-*–]\s+/u;
const SEPARATOR = /\s+(?:\||@|at|-|–|—)\s+|\s*[|•]\s*|,\s+/iu;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu;
const PHONE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/u;
const LINKEDIN = /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[A-Za-z0-9_%-]+/iu;
const GITHUB = /(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9-]+/iu;
const SCHOOL = /\b(?:university|college|institute|school|academy|polytechnic|universit[aäé]t?)\b/iu;
const DEGREE =
  /\b(?:Ph\.?D\.?|Doctor(?:ate)? of [A-Za-z ]+|Master(?:'s)? of [A-Za-z ]+|Bachelor(?:'s)? of [A-Za-z ]+|Associate(?:'s)? (?:of|in) [A-Za-z ]+|(?:B|M)\.(?:S|A|Eng)\.?|MBA|BSc|MSc|BEng|MEng|BA|BS|MS)\b[^,|;–—]*/u;
const TITLE =
  /\b(?:engineer|developer|manager|analyst|designer|director|lead|intern|consultant|specialist|architect|scientist|administrator|coordinator|associate|assistant|officer|president|founder|technician|representative|programmer|researcher|supervisor|executive|head|owner|partner)\b/iu;
const PROHIBITED_SKILL = /(?:sponsor|citizen|visa|veteran|disab|race|gender|criminal)/iu;

function headingOf(block: NormalizedResumeBlock): Heading | undefined {
  const text = block.text.replace(/[:\s]+$/u, "").trim();
  if (text.length === 0 || text.length > 40 || BULLET.test(text)) return undefined;
  for (const { kind, pattern } of HEADINGS) if (pattern.test(text)) return kind;
  return undefined;
}

function monthNumber(token: string): string | undefined {
  return MONTHS[token.slice(0, 3).toLowerCase()];
}

function toDate(point: string, edge: "start" | "end"): string | undefined {
  const trimmed = point.trim();
  const named = new RegExp(`^(${MONTH})\\s+((?:19|20)\\d{2})$`, "iu").exec(trimmed);
  if (named) {
    const month = monthNumber(named[1] ?? "");
    return month ? `${named[2]}-${month}-01` : undefined;
  }
  const numeric = /^(\d{1,2})\/((?:19|20)\d{2})$/u.exec(trimmed);
  if (numeric) {
    const month = Number(numeric[1]);
    return month >= 1 && month <= 12
      ? `${numeric[2]}-${String(month).padStart(2, "0")}-01`
      : undefined;
  }
  const year = /^((?:19|20)\d{2})$/u.exec(trimmed);
  if (year) return edge === "start" ? `${year[1]}-01-01` : `${year[1]}-12-31`;
  return undefined;
}

interface DateRange {
  startDate?: string;
  endDate?: string;
  rest: string;
}

function readRange(text: string): DateRange | undefined {
  const match = RANGE.exec(text);
  if (!match) return undefined;
  const startDate = toDate(match[1] ?? "", "start");
  const second = (match[2] ?? "").toLowerCase();
  const endDate = /^(?:present|current|now|ongoing)$/u.test(second)
    ? undefined
    : toDate(match[2] ?? "", "end");
  if (!startDate || (endDate && endDate < startDate)) return undefined;
  const rest = `${text.slice(0, match.index)} ${text.slice(match.index + match[0].length)}`
    .replace(/[()]/gu, " ")
    .replace(/\s+/gu, " ")
    .replace(/^[\s,|\-–—]+|[\s,|\-–—]+$/gu, "");
  return { startDate, ...(endDate ? { endDate } : {}), rest };
}

function clean(value: string, max: number): string | undefined {
  const text = value.replace(/\s+/gu, " ").replace(/^[\s,|\-–—:]+|[\s,|\-–—:]+$/gu, "");
  return text.length >= 1 && text.length <= max && /\S/u.test(text) ? text : undefined;
}

function unbullet(text: string): string {
  return text.replace(BULLET, "").trim();
}

function personalDraft(header: readonly NormalizedResumeBlock[]): ResumeDraft | undefined {
  const values: Record<string, unknown> = {};
  const links: Array<{ kind: "linkedin" | "github"; url: string }> = [];
  for (const block of header) {
    const text = block.text;
    const email = EMAIL.exec(text);
    if (email && values.email === undefined && email[0].length <= 254) values.email = email[0];
    const phone = PHONE.exec(text);
    if (phone && values.phone === undefined) values.phone = phone[0].trim();
    const linkedin = LINKEDIN.exec(text);
    if (linkedin && !links.some((link) => link.kind === "linkedin")) {
      links.push({ kind: "linkedin", url: `https://${linkedin[0].replace(/^https?:\/\//iu, "")}` });
    }
    const github = GITHUB.exec(text);
    if (github && !links.some((link) => link.kind === "github")) {
      links.push({ kind: "github", url: `https://${github[0].replace(/^https?:\/\//iu, "")}` });
    }
  }
  const nameBlock = header.find((block) => {
    const words = block.text.trim().split(/\s+/u);
    return (
      words.length >= 2 &&
      words.length <= 4 &&
      block.text.length <= 60 &&
      words.every((word) => /^\p{Lu}[\p{L}'.-]*$/u.test(word))
    );
  });
  if (nameBlock) values.fullName = nameBlock.text.trim();
  if (links.length > 0) values.links = links;
  return Object.keys(values).length > 0 ? { section: "personal", values } : undefined;
}

function skillDrafts(blocks: readonly NormalizedResumeBlock[], inline: boolean): ResumeDraft[] {
  const seen = new Set<string>();
  const drafts: ResumeDraft[] = [];
  for (const block of blocks) {
    let text = unbullet(block.text);
    if (inline) {
      const heading = /^skills?(?:\s*&\s*(?:tools|technologies))?\s*[:|-]\s*/iu.exec(text);
      if (!heading) continue;
      text = text.slice(heading[0].length);
    } else {
      text = text.replace(/^[A-Za-z][A-Za-z &/+#.-]{1,30}:\s+/u, "");
    }
    for (const token of text.split(/[,;|•\n]+/u)) {
      const value = clean(token, 100);
      if (!value || PROHIBITED_SKILL.test(value)) continue;
      const signature = value.toLocaleLowerCase("en-US");
      if (seen.has(signature)) continue;
      seen.add(signature);
      drafts.push({ section: "skill", values: { name: value } });
      if (drafts.length >= RESUME_DRAFT_LIMITS.skill) return drafts;
    }
  }
  return drafts;
}

function educationDrafts(blocks: readonly NormalizedResumeBlock[]): ResumeDraft[] {
  // An entry starts at the line naming its school; the lines after it describe the same entry.
  const groups: NormalizedResumeBlock[][] = [];
  for (const block of blocks) {
    if (SCHOOL.test(unbullet(block.text))) groups.push([block]);
    else groups.at(-1)?.push(block);
  }
  const drafts: ResumeDraft[] = [];
  for (const group of groups) {
    const joined = group.map((block) => unbullet(block.text)).join(" | ");
    const range = readRange(joined);
    const graduated = range ? undefined : SINGLE_POINT.exec(joined);
    const stripped = range ? range.rest : joined;
    const school = stripped
      .split(SEPARATOR)
      .map((piece) => piece.trim())
      .find((piece) => SCHOOL.test(piece));
    const schoolName = school ? clean(school, 200) : undefined;
    if (!schoolName) continue;
    const values: Record<string, unknown> = { school: schoolName };
    const degreeMatch = DEGREE.exec(stripped);
    if (degreeMatch) {
      const text = degreeMatch[0].replace(/\s+/gu, " ").trim();
      const split = /^(.*?)\s+in\s+(.+)$/iu.exec(text);
      const degree = clean(split ? (split[1] ?? "") : text, 200);
      const field = split ? clean(split[2] ?? "", 200) : undefined;
      if (degree && !SCHOOL.test(degree)) values.degree = degree;
      if (field && !SCHOOL.test(field)) values.fieldOfStudy = field;
    }
    if (range?.startDate) values.startDate = range.startDate;
    if (range?.endDate) values.endDate = range.endDate;
    if (!range && graduated) {
      const endDate = toDate(graduated[1] ?? "", "end");
      if (endDate) values.endDate = endDate;
    }
    drafts.push({ section: "education", values });
    if (drafts.length >= RESUME_DRAFT_LIMITS.education) break;
  }
  return drafts;
}

function piecesOf(text: string): string[] {
  return text
    .split(SEPARATOR)
    .map((piece) => piece.trim())
    .filter(Boolean);
}

function workDrafts(blocks: readonly NormalizedResumeBlock[]): ResumeDraft[] {
  const headers: Array<{ index: number; range: DateRange }> = [];
  blocks.forEach((block, index) => {
    if (BULLET.test(block.text)) return;
    const range = readRange(block.text);
    if (range) headers.push({ index, range });
  });
  const headerIndexes = new Set(headers.map((header) => header.index));
  const plainLine = (index: number): string | undefined => {
    const block = blocks[index];
    return block &&
      !BULLET.test(block.text) &&
      !headerIndexes.has(index) &&
      block.text.length <= 200
      ? block.text
      : undefined;
  };
  const drafts: ResumeDraft[] = [];
  for (const [position, header] of headers.entries()) {
    const nextIndex = headers[position + 1]?.index ?? blocks.length;
    let pieces = piecesOf(header.range.rest);
    let bulletsFrom = header.index + 1;
    const above = plainLine(header.index - 1);
    if (pieces.length < 2 && above !== undefined) pieces = [...piecesOf(above), ...pieces];
    const below = plainLine(header.index + 1);
    if (pieces.length < 2 && below !== undefined) {
      pieces = [...pieces, ...piecesOf(below)];
      bulletsFrom = header.index + 2;
    }
    const titleLike = pieces.filter((piece) => TITLE.test(piece));
    const company = clean(pieces.find((piece) => !TITLE.test(piece)) ?? "", 200);
    const title = clean(titleLike[0] ?? "", 200);
    if (titleLike.length !== 1 || !company || !title || !header.range.startDate) continue;
    const bullets: string[] = [];
    for (let i = bulletsFrom; i < nextIndex && bullets.length < 20; i++) {
      const block = blocks[i];
      if (!block || !BULLET.test(block.text)) continue;
      const text = unbullet(block.text);
      if (text.length >= 1 && text.length <= 500) bullets.push(text);
    }
    drafts.push({
      section: "workExperience",
      values: {
        company,
        title,
        startDate: header.range.startDate,
        ...(header.range.endDate ? { endDate: header.range.endDate } : {}),
        ...(bullets.length > 0 ? { bullets } : {}),
      },
    });
    if (drafts.length >= RESUME_DRAFT_LIMITS.workExperience) break;
  }
  return drafts;
}

/** Splits the document by section headings and extracts drafts from each section it understands. */
export function extractResumeDrafts(document: NormalizedResumeDocument): ResumeDraft[] {
  const sections = new Map<Heading, NormalizedResumeBlock[]>();
  const header: NormalizedResumeBlock[] = [];
  let current: Heading | undefined;
  for (const block of document.blocks) {
    const heading = headingOf(block);
    if (heading) {
      current = heading;
      if (!sections.has(heading)) sections.set(heading, []);
      continue;
    }
    if (current === undefined) {
      if (header.length < 8) header.push(block);
    } else {
      sections.get(current)?.push(block);
    }
  }
  const drafts: ResumeDraft[] = [];
  const personal = personalDraft(header);
  if (personal) drafts.push(personal);
  drafts.push(...educationDrafts(sections.get("education") ?? []));
  drafts.push(...workDrafts(sections.get("experience") ?? []));
  const skillBlocks = sections.get("skills") ?? [];
  const inlineSkills = skillDrafts(document.blocks, true);
  const listed = skillDrafts(skillBlocks, false);
  const seen = new Set<string>();
  for (const draft of [...inlineSkills, ...listed]) {
    const signature = String(draft.values.name).toLocaleLowerCase("en-US");
    if (seen.has(signature) || seen.size >= RESUME_DRAFT_LIMITS.skill) continue;
    seen.add(signature);
    drafts.push(draft);
  }
  return drafts;
}
