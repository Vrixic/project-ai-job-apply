import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const mobileRequire = createRequire(new URL("../../frontend/mobile/package.json", import.meta.url));
const expoRequire = createRequire(mobileRequire.resolve("expo/package.json"));
const cliRequire = createRequire(expoRequire.resolve("@expo/cli/package.json"));
const fileMapRequire = createRequire(cliRequire.resolve("@expo/metro-file-map/package.json"));
const micromatchRequire = createRequire(fileMapRequire.resolve("micromatch/package.json"));
const braces = micromatchRequire("braces");
const nestingError = {
  name: "SyntaxError",
  message: "Brace pattern exceeds maximum nesting depth",
};

for (const method of ["parse", "compile", "expand", "stringify"]) {
  for (const [open, close] of [
    ["{", "}"],
    ["(", ")"],
    ["{(", ")}"],
  ]) {
    for (const depth of [129, 2000]) {
      test(`${method} bounds ${open} nesting at ${depth}`, () => {
        const pattern = `${open.repeat(depth)}a${close.repeat(depth)}`;
        assert.throws(() => braces[method](pattern), nestingError);
      });
    }
    test(`${method} bounds unclosed ${open} nesting`, () => {
      assert.throws(() => braces[method](`${open.repeat(2000)}a`), nestingError);
    });
  }
  test(`${method} permits 128 balanced nesting levels`, () => {
    assert.doesNotThrow(() => braces[method](`${"{".repeat(128)}a${"}".repeat(128)}`));
  });
  test(`${method} treats escaped braces as text`, () => {
    assert.doesNotThrow(() => braces[method](`${"\\{".repeat(300)}a`));
  });
  test(`${method} treats quoted braces as text`, () => {
    assert.doesNotThrow(() => braces[method](`"${"{".repeat(300)}"`));
  });
}

for (const method of ["compile", "expand", "stringify"]) {
  test(`${method} bounds a directly supplied deeply nested AST`, () => {
    let ast = { type: "root", nodes: [] };
    for (let i = 0; i < 2000; i++) ast = { type: "root", nodes: [ast] };
    assert.throws(() => braces[method](ast), nestingError);
  });
  test(`${method} bounds a cyclic child AST`, () => {
    const ast = { type: "root", nodes: [] };
    ast.nodes.push(ast);
    assert.throws(() => braces[method](ast), nestingError);
  });
}

test("normal alternation, ranges and escaping remain compatible", () => {
  assert.equal(braces.compile("src/{app,lib}/file-{1..3}.js"), "src/(app|lib)/file-([1-3]).js");
  assert.deepEqual(braces.expand("{a,{b,c}}-{01..03}"), [
    "a-01",
    "a-02",
    "a-03",
    "b-01",
    "b-02",
    "b-03",
    "c-01",
    "c-02",
    "c-03",
  ]);
  assert.equal(braces.stringify(braces.parse("a/{b,c}/d")), "a/{b,c}/d");
  assert.deepEqual(braces.expand("\\{literal\\}"), ["{literal}"]);
  assert.deepEqual(braces.expand("{a,a,b}", { nodupes: true }), ["a", "b"]);
});

test("callers cannot disable the nesting ceiling with unrelated limits", () => {
  assert.throws(
    () =>
      braces.expand(`${"{".repeat(129)}a${"}".repeat(129)}`, {
        maxLength: Infinity,
        rangeLimit: false,
        maxDepth: Infinity,
      }),
    nestingError,
  );
});
