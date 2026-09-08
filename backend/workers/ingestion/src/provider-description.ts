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

/** Inert, bounded provider HTML conversion. No resource fetch or page-owned execution. */
export function parsePublicDescriptionHtml(value: unknown): Readonly<{
  plainText: string;
  textContent: string;
  firstHeading?: string;
}> {
  const html = canonicalProviderText(value, "The provider description HTML", 100_000);
  const fragment = parseFragment(html);
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
