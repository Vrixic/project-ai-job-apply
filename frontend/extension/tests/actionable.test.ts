// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { isActionable, isOverlayChoice } from "../lib/actionable";
import { ashbyProvider } from "../lib/ashby/provider";

const view = window as Window & typeof globalThis;

afterEach(() => {
  document.body.innerHTML = "";
});

function mount(html: string) {
  document.body.innerHTML = html;
  return document.body;
}

/** jsdom has no layout: give an element a box, as a browser would for a laid-over input. */
function box(element: Element, size = 24) {
  Object.defineProperty(element, "offsetWidth", { configurable: true, value: size });
  Object.defineProperty(element, "offsetHeight", { configurable: true, value: size });
  element.getBoundingClientRect = () =>
    ({ left: 10, top: 10, width: size, height: size }) as DOMRect;
}

describe("isActionable", () => {
  it("refuses a transparent text input: only a laid-over radio or checkbox may be transparent", () => {
    const root = mount('<input id="t" type="text" style="opacity:0">');
    const input = root.querySelector("#t") as HTMLInputElement;
    box(input);
    expect(isOverlayChoice(input, view)).toBe(false);
    expect(isActionable(input, view)).toBe(false);
  });

  it("accepts a transparent radio that has a box and visible ancestors", () => {
    const root = mount('<span><input id="r" type="radio" style="opacity:0"></span>');
    const radio = root.querySelector("#r") as HTMLInputElement;
    box(radio);
    expect(isOverlayChoice(radio, view)).toBe(true);
    expect(isActionable(radio, view)).toBe(true);
  });

  it("refuses a transparent radio with no box, or inside a transparent or hidden ancestor", () => {
    const empty = mount('<input id="r" type="radio" style="opacity:0">').querySelector("#r");
    expect(isActionable(empty as Element, view)).toBe(false);
    for (const wrapper of ['style="opacity:0"', 'style="display:none"', "hidden"]) {
      const radio = mount(`<div ${wrapper}><input id="r" type="radio" style="opacity:0"></div>`);
      const input = radio.querySelector("#r") as Element;
      box(input);
      expect(isActionable(input, view)).toBe(false);
    }
  });

  it("when it will be clicked, requires that the click lands on the input itself", () => {
    const root = mount('<div id="cover"></div><input id="r" type="radio" style="opacity:0">');
    const radio = root.querySelector("#r") as HTMLInputElement;
    box(radio);
    document.elementFromPoint = () => radio;
    expect(isActionable(radio, view, { hitTest: true })).toBe(true);
    document.elementFromPoint = () => root.querySelector("#cover");
    expect(isActionable(radio, view, { hitTest: true })).toBe(false);
    // Reading state does not click, so it does not hit-test.
    expect(isActionable(radio, view)).toBe(true);
  });

  it("still refuses disabled controls", () => {
    const root = mount('<input id="r" type="radio" disabled style="opacity:0">');
    const radio = root.querySelector("#r") as HTMLInputElement;
    box(radio);
    expect(isActionable(radio, view)).toBe(false);
  });
});

describe("Ashby selectionWritten", () => {
  const radios = (checked: number | null) => {
    const root = mount(
      ["No", "Yes, H1B Transfer", "Yes, Other"]
        .map(
          (text, index) =>
            `<div><input type="radio" id="o${index}" name="g" ${checked === index ? "checked" : ""}><label for="o${index}">${text}</label></div>`,
        )
        .join(""),
    );
    return Array.from(root.querySelectorAll("input"));
  };

  it("is true only when exactly the approved radio option is chosen", () => {
    expect(ashbyProvider.selectionWritten?.(radios(0), "No")).toBe(true);
    expect(ashbyProvider.selectionWritten?.(radios(1), "No")).toBe(false);
    expect(ashbyProvider.selectionWritten?.(radios(null), "No")).toBe(false);
    expect(ashbyProvider.selectionWritten?.(radios(0), "Maybe")).toBe(false);
  });

  it("reads a Yes/No button pair by which one is pressed", () => {
    const root = mount(
      '<button data-option="yes" aria-pressed="false">Yes</button><button data-option="no" aria-pressed="true">No</button>',
    );
    const buttons = Array.from(root.querySelectorAll("button"));
    expect(ashbyProvider.selectionWritten?.(buttons, "No")).toBe(true);
    expect(ashbyProvider.selectionWritten?.(buttons, "Yes")).toBe(false);
  });
});
