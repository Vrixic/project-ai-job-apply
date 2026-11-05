/** The nearest element at or above `element` that has a box on screen, so a hidden control scrolls its visible wrapper. */
function visibleAncestor(element: Element): Element {
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (node instanceof HTMLElement && node.offsetWidth > 0 && node.offsetHeight > 0) return node;
  }
  return element;
}

/**
 * Scrolls the control being filled into the middle of the window and waits a moment, so the
 * candidate can watch the page fill. Scrolling moves the view only; it changes no page value.
 */
export async function revealControl(
  control: Element,
  pauseMs: number,
  stopped: Promise<unknown>,
): Promise<void> {
  if (pauseMs <= 0) return;
  const target = visibleAncestor(control);
  if (typeof target.scrollIntoView === "function")
    target.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
  await Promise.race([new Promise<void>((resolve) => setTimeout(resolve, pauseMs)), stopped]);
}
