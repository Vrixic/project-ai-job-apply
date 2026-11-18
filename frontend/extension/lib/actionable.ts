type View = Window & typeof globalThis;

/**
 * Whether the extension may act on, or trust the state of, a page control: it must be something the
 * candidate could see and use. A disabled, read-only, hidden, inert, collapsed or fully transparent
 * control, or one inside such an ancestor, is refused.
 *
 * One pattern is real and common: a custom-styled radio or checkbox draws its own circle or box and
 * lays the actual `<input>` over it at opacity 0, so the candidate clicks the input without seeing
 * it. Only such an input is accepted, and only when it has a box of its own and every ancestor is
 * visible. When the caller is about to click it, `hitTest` also requires that the element at the
 * middle of its box is the input itself, so a click lands on it and not on something laid over it.
 */
export function isOverlayChoice(element: Element, view: View): boolean {
  if (!(element instanceof view.HTMLInputElement)) return false;
  if (element.type !== "radio" && element.type !== "checkbox") return false;
  return (
    view.getComputedStyle(element).opacity === "0" &&
    element.offsetWidth > 0 &&
    element.offsetHeight > 0
  );
}

export function isActionable(
  element: Element,
  view: View,
  options: { hitTest?: boolean } = {},
): boolean {
  if (element.matches(":disabled") || element.hasAttribute("readonly")) return false;
  const overlay = isOverlayChoice(element, view);
  for (let node: Element | null = element; node; node = node.parentElement) {
    const style = view.getComputedStyle(node);
    if (
      node.hasAttribute("hidden") ||
      node.hasAttribute("inert") ||
      node.getAttribute("aria-hidden") === "true" ||
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      (style.opacity === "0" && !(overlay && node === element))
    )
      return false;
  }
  if (overlay && options.hitTest === true) {
    const box = element.getBoundingClientRect();
    return (
      element.ownerDocument.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2) ===
      element
    );
  }
  return true;
}
