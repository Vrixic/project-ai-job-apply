import { describe, expect, it } from "vitest";
import { expandWrappers, operations, tokenize, topLevelGroups } from "./content-stream.js";

const units = (source: string) => {
  const bytes = new TextEncoder().encode(source);
  return expandWrappers(bytes, topLevelGroups(operations(bytes, tokenize(bytes))));
};
const text = (y: number, word: string, extra = "") =>
  `q\n${extra}BT /F1 12 Tf 1 0 0 1 10 ${y} Tm (${word}) Tj ET\nQ`;

describe("opening wrappers", () => {
  it("makes each child of a clip wrapper a unit and leaves the wrapper in place", () => {
    const result = units(`q\n0 0 100 100 re\nW* n\n${text(10, "a")}\nEMC\n${text(30, "b")}\nQ`);
    expect(result.map((unit) => unit.loose)).toEqual([true, false, true, false, true]);
    expect(result.filter((unit) => !unit.loose)).toHaveLength(2);
  });

  it("records the colors a child inherits, so text only moves between places with the same state", () => {
    const [, first, , second] = units(
      `q\n0 0 100 100 re\nW* n\n${text(10, "a")}\n1 0 0 rg\n${text(30, "b")}\nQ`,
    );
    expect(first?.state).toBeDefined();
    expect(second?.state).toBeDefined();
    expect(first?.state).not.toBe(second?.state);
  });

  it("gives children with no state change between them the same state", () => {
    const result = units(`q\n0 0 100 100 re\nW* n\n${text(10, "a")}\n${text(30, "b")}\nQ`).filter(
      (unit) => !unit.loose,
    );
    expect(result[0]?.state).toBe(result[1]?.state);
  });

  it("makes a small filled shape drawn by the wrapper itself a unit of its own", () => {
    const result = units(`q\n0 0 100 100 re\nW* n\n${text(10, "a")}\n5 5 20 1 re\nf*\nQ`);
    expect(result.filter((unit) => !unit.loose)).toHaveLength(2);
  });

  it("does not open a wrapper that shows text itself", () => {
    const result = units(`q\nBT /F1 12 Tf 1 0 0 1 10 5 Tm (x) Tj ET\n${text(10, "a")}\nQ`);
    expect(result).toHaveLength(1);
    expect(result[0]?.loose).toBe(false);
  });

  it("does not open a wrapper that changes the matrix", () => {
    const result = units(`q\n2 0 0 2 0 0 cm\n${text(10, "a")}\nQ`);
    expect(result).toHaveLength(1);
    expect(result[0]?.loose).toBe(false);
  });

  it("opens a wrapper inside a wrapper", () => {
    const result = units(
      `q\n0 0 100 100 re\nW* n\nq\n0 0 50 50 re\nW* n\n${text(10, "a")}\n${text(20, "b")}\nQ\nQ`,
    );
    expect(result.filter((unit) => !unit.loose)).toHaveLength(2);
  });
});
