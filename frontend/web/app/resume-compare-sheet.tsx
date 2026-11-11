"use client";

import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

/** How long the panel takes to slide out; the stylesheet's transition is the same length. */
const CLOSE_ANIMATION_MS = 220;
const FOCUSABLE =
  'a[href], button:not([disabled]), summary, input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type SheetState = "entering" | "open" | "leaving";

const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Runs `callback` after the first paint, so the slide-in starts from the closed position. */
function afterFirstPaint(callback: () => void): () => void {
  if (typeof requestAnimationFrame === "function") {
    const frame = requestAnimationFrame(() => callback());
    return () => cancelAnimationFrame(frame);
  }
  const timer = setTimeout(callback, 0);
  return () => clearTimeout(timer);
}

/**
 * A panel that slides in from the right edge over the whole height of the window, for a view that needs
 * room (the resume comparison). It is a modal dialog: focus moves into it and stays there, Escape or the
 * Close button or a click beside it closes it, and the page behind does not scroll. The caller restores
 * focus once it has closed.
 */
export function ResumeCompareSheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose(): void;
  children: ReactNode;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const leaving = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [state, setState] = useState<SheetState>("entering");

  useEffect(
    () => afterFirstPaint(() => setState((current) => (current === "entering" ? "open" : current))),
    [],
  );

  useEffect(() => {
    closeButton.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      if (leaving.current !== undefined) clearTimeout(leaving.current);
    };
  }, []);

  const requestClose = useCallback(() => {
    if (leaving.current !== undefined) return;
    if (prefersReducedMotion()) {
      onClose();
      return;
    }
    setState("leaving");
    leaving.current = setTimeout(onClose, CLOSE_ANIMATION_MS);
  }, [onClose]);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      requestClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [requestClose]);

  // Tab and Shift+Tab wrap inside the panel, so focus never lands on the page behind it.
  function keepFocusInside(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab" || !panel.current) return;
    const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !panel.current.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !panel.current.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="resume-sheet" data-state={state}>
      <div className="resume-sheet-scrim" aria-hidden="true" onClick={requestClose} />
      <div
        ref={panel}
        className="resume-sheet-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={keepFocusInside}
      >
        <header className="resume-sheet-head">
          <h2 id={titleId}>{title}</h2>
          <button ref={closeButton} type="button" onClick={requestClose}>
            Close
          </button>
        </header>
        <div className="resume-sheet-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
