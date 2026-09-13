import { type DefaultTreeAdapterTypes, parseFragment } from "parse5";
import { canonicalProviderText } from "./provider-http.js";

const skipped = new Set([
  "script",
  "style",
  "template",
  "noscript",
  "iframe",
  "object",
  "svg",
  "math",
  "form",
  "input",
  "textarea",
  "select",
  "button",
]);
const blocks = new Set([
  "p",
  "div",
  "section",
  "article",
  "header",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "table",
  "tr",
  "td",
  "th",
  "hr",
]);

type PublicDescription = Readonly<{
  plainText: string;
  textContent: string;
  firstHeading?: string;
}>;

function publicDescriptionFragment(value: unknown): DefaultTreeAdapterTypes.DocumentFragment {
  const html = canonicalProviderText(value, "The provider description HTML", 100_000);
  return parseFragment(html);
}

/** Inert, bounded provider HTML conversion. No resource fetch or page-owned execution. */
export function parsePublicDescriptionHtml(value: unknown): PublicDescription {
  return publicDescriptionFromFragment(publicDescriptionFragment(value));
}

function publicDescriptionFromFragment(
  fragment: DefaultTreeAdapterTypes.DocumentFragment,
): PublicDescription {
  const pending: (DefaultTreeAdapterTypes.ChildNode | string)[] = [
    ...fragment.childNodes,
  ].reverse();
  const plain: string[] = [];
  const page: string[] = [];
  let visited = 0;
  while (pending.length > 0) {
    if (++visited > 100_000) throw new Error("The provider description HTML is too complex");
    const node = pending.pop();
    if (typeof node === "string") {
      plain.push(node);
    } else if (node && "value" in node) {
      plain.push(node.value);
      page.push(node.value);
    } else if (node && "tagName" in node && !skipped.has(node.tagName)) {
      if (node.tagName === "br") {
        plain.push("\n");
        continue;
      }
      if (blocks.has(node.tagName)) {
        plain.push("\n");
        pending.push("\n");
      }
      for (let index = node.childNodes.length - 1; index >= 0; index--) {
        const child = node.childNodes[index];
        if (child) pending.push(child);
      }
    }
  }
  const firstElement = fragment.childNodes.find((node) => "tagName" in node);
  let firstHeading: string | undefined;
  if (firstElement && "tagName" in firstElement && /^h[1-6]$/u.test(firstElement.tagName)) {
    const headingParts: string[] = [];
    const headingNodes = [...firstElement.childNodes].reverse();
    while (headingNodes.length > 0) {
      const node = headingNodes.pop();
      if (node && "value" in node) headingParts.push(node.value);
      else if (node && "tagName" in node && !skipped.has(node.tagName)) {
        for (let index = node.childNodes.length - 1; index >= 0; index--) {
          const child = node.childNodes[index];
          if (child) headingNodes.push(child);
        }
      }
    }
    firstHeading = headingParts.join("");
  }
  const plainText = canonicalProviderText(
    plain
      .join("")
      .replace(/[ \t]+/gu, " ")
      .replace(/\s*\n\s*/gu, "\n")
      .replace(/\n{3,}/gu, "\n\n"),
    "The provider description text",
    100_000,
  );
  return Object.freeze({
    plainText,
    textContent: page.join(""),
    ...(firstHeading ? { firstHeading } : {}),
  });
}

/**
 * Ashby's native plain description includes HTML-derived URL/image annotations, list bullets,
 * and uppercase headings. Corroborate that complete independent representation, not a stripped
 * candidate excerpt. Return only the unchanged shared page representation; never replace catalog
 * plaintext or grant these aliases to another provider.
 */
export function parseCorroboratedAshbyDescriptionHtml(
  value: unknown,
  canonicalDescription: string,
): PublicDescription | undefined {
  const fragment = publicDescriptionFragment(value);
  const parsed = publicDescriptionFromFragment(fragment);
  const equivalent = (text: string) => text.replace(/\s+/gu, " ").trim();
  const expected = equivalent(canonicalDescription);
  if (equivalent(parsed.plainText) === expected) return parsed;
  const native = ashbyNativePlainDescription(fragment);
  return native !== undefined && equivalent(native) === expected ? parsed : undefined;
}

function ashbyNativePlainDescription(
  fragment: DefaultTreeAdapterTypes.DocumentFragment,
): string | undefined {
  type Frame = { node: DefaultTreeAdapterTypes.ChildNode; uppercase: boolean } | { text: string };
  const pending: Frame[] = fragment.childNodes
    .map((node) => ({ node, uppercase: false }))
    .reverse();
  const parts: string[] = [];
  let length = 0;
  let visited = 0;
  const append = (value: string) => {
    length += value.length;
    if (length > 100_000) return false;
    parts.push(value);
    return true;
  };
  while (pending.length > 0) {
    if (++visited > 100_000) return undefined;
    const frame = pending.pop();
    if (!frame) continue;
    if ("text" in frame) {
      if (!append(frame.text)) return undefined;
      continue;
    }
    const { node } = frame;
    if ("value" in node) {
      if (!append(frame.uppercase ? node.value.toUpperCase() : node.value)) return undefined;
      continue;
    }
    if (!("tagName" in node) || skipped.has(node.tagName)) continue;
    const uppercase = frame.uppercase || /^h[1-6]$/u.test(node.tagName);
    if (node.tagName === "br") {
      if (!append("\n")) return undefined;
      continue;
    }
    if (node.tagName === "img") {
      const alt = node.attrs.find((attribute) => attribute.name === "alt")?.value ?? "";
      const src = node.attrs.find((attribute) => attribute.name === "src")?.value;
      if (src && !safeNativeUrlAnnotation(src)) return undefined;
      if (!append(uppercase ? alt.toUpperCase() : alt)) return undefined;
      if (src && !append(` [${src}]`)) return undefined;
      continue;
    }
    if (blocks.has(node.tagName)) {
      if (!append("\n")) return undefined;
      pending.push({ text: "\n" });
    }
    if (node.tagName === "li" && !append("- ")) return undefined;
    if (node.tagName === "a") {
      const href = node.attrs.find((attribute) => attribute.name === "href")?.value;
      if (href && !safeNativeUrlAnnotation(href)) return undefined;
      // URL spelling is evidence. Never case-fold, suppress, decode again, or rewrite it.
      if (href) pending.push({ text: ` ${href}` });
    }
    for (let index = node.childNodes.length - 1; index >= 0; index--) {
      const child = node.childNodes[index];
      if (child) pending.push({ node: child, uppercase });
    }
  }
  return parts.join("");
}

function safeNativeUrlAnnotation(value: string): boolean {
  // Whole-description whitespace normalization must not normalize URL evidence. Decline this
  // additional representation rather than strip controls, collapse spaces, or rewrite a URL.
  if (/\s/u.test(value)) return false;
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (
      code < 32 ||
      (code >= 127 && code <= 159) ||
      (code >= 0x200b && code <= 0x200f) ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2060 && code <= 0x206f) ||
      code === 0xfeff
    )
      return false;
  }
  return true;
}
