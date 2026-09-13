const MARKUP_START = /<(?:\/?[a-z]|[!?])/iu;
const UNSAFE_CONTROL =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: reject controls and bidi overrides without rejecting plaintext comparison operators.
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;

/** Validate selected plaintext without stripping markup or changing comparison operators. */
export function isSafeContributionDescription(value: string): boolean {
  return [value, value.normalize("NFKC")].every(
    (text) => !MARKUP_START.test(text) && !UNSAFE_CONTROL.test(text),
  );
}
