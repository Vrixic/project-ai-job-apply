/**
 * Salary questions answered from the one number the candidate set in their Profile: the annual
 * salary they want, in dollars. Three shapes of question are covered:
 *
 *  - an input box: that number as written;
 *  - a dropdown or radio list of ranges: the range that holds it, else the closest one (the
 *    highest when it is above them all, the lowest when it is below them all);
 *  - "does the posted salary meet your expectations?": Yes when the posted range can pay it.
 *
 * Only annual dollar amounts are understood. A question about an hourly or monthly rate, or one
 * that names another currency, is left to the candidate: a number is never converted or guessed.
 */

export interface SalaryBounds {
  /** Inclusive lower end; undefined when the range is open below ("under $50,000"). */
  low?: number;
  /** Inclusive upper end; undefined when the range is open above ("$150,000+"). */
  high?: number;
}

export interface SalaryChoice {
  option: string;
  /** True when the range holds the salary; false when it is only the closest one. */
  within: boolean;
}

const OTHER_CURRENCY =
  /[£€₹¥₩]|\b(?:gbp|eur|inr|jpy|cny|cad|aud|nzd|chf|sek|nok|dkk|pln|brl|mxn|sgd|zar)\b|\b(?:c|ca|a|au|nz)\$/iu;
const NOT_ANNUAL =
  /\b(?:hour|hours|hourly|hr|hrs|day|daily|week|weekly|bi-?weekly|month|monthly|quarterly)\b|\/\s*(?:h|hr|hour|day|wk|week|mo|month)\b/iu;
const LOW_ONLY =
  /\b(?:over|above|more\s+than|at\s+least|minimum|min|from|starting|plus)\b|\+|\bor\s+(?:more|above|higher|greater)\b|\band\s+(?:above|up|over)\b|>=?|≥/iu;
const HIGH_ONLY =
  /\b(?:under|below|less\s+than|up\s*to|upto|at\s+most|maximum|max|no\s+more\s+than|lower\s+than)\b|<=?|≤/iu;
const RANGE_SEPARATOR = /^\s*(?:-|to|and|through|thru)\s*$/iu;
const MULTIPLIER: Record<string, number> = {
  k: 1_000,
  thousand: 1_000,
  m: 1_000_000,
  million: 1_000_000,
};

interface Amount {
  value: number;
  index: number;
  end: number;
  suffixed: boolean;
}

/** True when nothing in the text says the amounts are hourly, monthly or in another currency. */
export function isAnnualDollarText(text: string): boolean {
  return !OTHER_CURRENCY.test(text) && !NOT_ANNUAL.test(text);
}

function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‐-―−]/gu, "-")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * The money in a text. `strict` (a question's own sentence) counts only an amount with a dollar
 * sign, a thousands separator or a k/m suffix, so "5 years" is not money. A short label ("$50-75k",
 * "100 - 150") is read leniently: when every number is under a thousand they are thousands.
 */
function amounts(text: string, strict: boolean): Amount[] {
  const found: Amount[] = [];
  const pattern = /(\$|usd\s?|us\$)?\s*(\d[\d,]*(?:\.\d+)?)\s*(k|m|thousand|million)?(?![\w(])/giu;
  for (const match of text.matchAll(pattern)) {
    const [whole, dollar, digits, suffix] = match;
    if (digits === undefined) continue;
    const separated = /,/u.test(digits);
    if (strict && !dollar && !suffix && !separated) continue;
    if (
      !strict &&
      !dollar &&
      !suffix &&
      !separated &&
      Number(digits.replace(/,/gu, "")) >= 1_000_000
    )
      continue;
    const base = Number(digits.replace(/,/gu, ""));
    if (!Number.isFinite(base)) continue;
    const start = match.index + (whole.length - whole.trimStart().length);
    found.push({
      value: base * (suffix ? (MULTIPLIER[suffix] ?? 1) : 1),
      index: start,
      end: match.index + whole.length,
      suffixed: suffix !== undefined,
    });
  }
  if (!strict && found.length > 0 && found.every((a) => a.value < 1_000 && !a.suffixed))
    for (const a of found) a.value *= 1_000;
  // "50-75k": the unit closes the range, so it belongs to both ends.
  const [first, second] = found;
  if (first && second && !first.suffixed && second.suffixed && first.value < 1_000) {
    const unit = /k|thousand/iu.test(text.slice(second.index, second.end)) ? 1_000 : 1_000_000;
    first.value *= unit;
  }
  return found;
}

/**
 * The salary range a text describes, or undefined when it holds no annual dollar amount (or says
 * it is hourly, monthly or in another currency). `strict` is for a question's own sentence.
 */
export function parseSalaryBounds(text: string, strict = false): SalaryBounds | undefined {
  if (!isAnnualDollarText(text)) return undefined;
  const clean = normalize(text);
  const found = amounts(clean, strict);
  const [first, second] = found;
  if (!first) return undefined;
  if (second) {
    // Two amounts are a range only when a range word sits between them.
    if (!RANGE_SEPARATOR.test(clean.slice(first.end, second.index).replace(/[$\s]*$/u, "")))
      return undefined;
    return { low: Math.min(first.value, second.value), high: Math.max(first.value, second.value) };
  }
  const low = LOW_ONLY.test(clean);
  const high = HIGH_ONLY.test(clean);
  if (low && !high) return { low: first.value };
  if (high && !low) return { high: first.value };
  return { low: first.value, high: first.value };
}

const distance = (bounds: SalaryBounds, desired: number): number => {
  if (bounds.low !== undefined && desired < bounds.low) return bounds.low - desired;
  if (bounds.high !== undefined && desired > bounds.high) return desired - bounds.high;
  return 0;
};

/**
 * The option of a list of salary ranges that holds the desired salary. When none does, the
 * closest: the highest range when the salary is above all of them, the lowest when below all, and
 * the nearer one when it falls between two. Options that are not a salary range ("Prefer not to
 * say") are ignored; with no range at all, nothing is chosen.
 */
export function chooseSalaryOption(
  options: readonly string[],
  desired: number,
): SalaryChoice | undefined {
  if (!Number.isFinite(desired) || desired <= 0) return undefined;
  const ranges = options
    .map((option) => ({ option, bounds: parseSalaryBounds(option) }))
    .filter(
      (entry): entry is { option: string; bounds: SalaryBounds } => entry.bounds !== undefined,
    );
  if (ranges.length === 0) return undefined;
  const rank = (entry: { bounds: SalaryBounds }) => {
    const { low, high } = entry.bounds;
    return {
      distance: distance(entry.bounds, desired),
      bounded: low !== undefined && high !== undefined ? 0 : 1,
      // Where two ranges meet, the salary belongs to the one it starts: [low, high).
      closed: high !== undefined && desired === high && high !== low ? 1 : 0,
      span: low !== undefined && high !== undefined ? high - low : Number.POSITIVE_INFINITY,
      low: low ?? Number.NEGATIVE_INFINITY,
    };
  };
  const ordered = [...ranges].sort((a, b) => {
    const x = rank(a);
    const y = rank(b);
    return (
      x.distance - y.distance ||
      x.closed - y.closed ||
      x.bounded - y.bounded ||
      x.span - y.span ||
      y.low - x.low
    );
  });
  const best = ordered[0];
  return best ? { option: best.option, within: distance(best.bounds, desired) === 0 } : undefined;
}

/**
 * Whether the salary posted in a question's own text can pay the desired salary, for "does the
 * posted salary meet your expectations?". A posted range above the desired salary meets it. Undefined
 * when the text holds no annual dollar range to judge.
 */
export function salaryMeetsPosted(text: string, desired: number): boolean | undefined {
  if (!Number.isFinite(desired) || desired <= 0) return undefined;
  const bounds = parseSalaryBounds(text, true);
  if (!bounds) return undefined;
  return desired <= (bounds.high ?? Number.POSITIVE_INFINITY);
}

/**
 * The value for a salary question from the candidate's desired salary: the number itself for an
 * input, Yes/No (as a boolean) for "does the posted salary meet your expectations?". Undefined
 * when the question is not about annual dollars.
 */
export function salaryAnswer(
  fieldKey: string,
  label: string,
  desired: unknown,
): number | boolean | undefined {
  if (typeof desired !== "number" || !Number.isFinite(desired) || desired <= 0) return undefined;
  if (!isAnnualDollarText(label)) return undefined;
  if (fieldKey === "job.salary_expectation") return desired;
  if (fieldKey === "job.salary_acceptable") return salaryMeetsPosted(label, desired);
  return undefined;
}
