import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const mobileRequire = createRequire(new URL("../../frontend/mobile/package.json", import.meta.url));
const expoRequire = createRequire(mobileRequire.resolve("expo/package.json"));
const configRequire = createRequire(expoRequire.resolve("@expo/config/package.json"));
const builds = {
  cjs: configRequire("deepmerge"),
  umd: createRequire(configRequire.resolve("deepmerge/package.json"))("./dist/umd.js"),
};
const poisoned = () => JSON.parse('{"__proto__":{"polluted":true},"kept":1}');

for (const [name, deepmerge] of Object.entries(builds)) {
  test(`${name}: an own __proto__ key in the target never replaces the result's prototype`, () => {
    const result = deepmerge(poisoned(), { other: 2 });
    assert.equal(result.polluted, undefined);
    assert.equal(Object.getPrototypeOf(result), Object.prototype);
    assert.equal(Object.hasOwn(result, "__proto__"), true);
    assert.equal(result.kept, 1);
    assert.equal(result.other, 2);
  });
  test(`${name}: an own __proto__ key in the source never replaces the result's prototype`, () => {
    const result = deepmerge({ a: 1 }, poisoned());
    assert.equal(result.polluted, undefined);
    assert.equal(Object.getPrototypeOf(result), Object.prototype);
    assert.equal(result.kept, 1);
  });
  test(`${name}: a nested own __proto__ key stays data too`, () => {
    const result = deepmerge({ a: poisoned() }, { a: { b: 2 } });
    assert.equal(result.a.polluted, undefined);
    assert.equal(Object.getPrototypeOf(result.a), Object.prototype);
    assert.equal(result.a.b, 2);
  });
  test(`${name}: global Object.prototype is never touched`, () => {
    deepmerge(poisoned(), poisoned());
    assert.equal({}.polluted, undefined);
  });
  test(`${name}: ordinary merging is unchanged`, () => {
    assert.deepEqual(deepmerge({ x: [1], y: { z: 1 } }, { x: [2], y: { w: 2 } }), {
      x: [1, 2],
      y: { z: 1, w: 2 },
    });
    assert.deepEqual(deepmerge.all([{ a: 1 }, { b: 2 }, { a: 3 }]), { a: 3, b: 2 });
    assert.deepEqual(deepmerge({ a: [1, 2] }, { a: [3] }, { arrayMerge: (_t, s) => s }), {
      a: [3],
    });
    const symbol = Symbol("key");
    assert.equal(deepmerge({ [symbol]: 1 }, { [symbol]: 2 })[symbol], 2);
  });
  test(`${name}: results are independent copies unless cloning is off`, () => {
    const source = { n: { v: 1 } };
    const result = deepmerge({}, source);
    result.n.v = 2;
    assert.equal(source.n.v, 1);
  });
}
