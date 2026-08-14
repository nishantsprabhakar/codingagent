const assert = require("assert");
const { deepEqual } = require("./deepEqual.js");

assert.strictEqual(deepEqual(1, 1), true);
assert.strictEqual(deepEqual(1, 2), false);
assert.strictEqual(deepEqual([1, 2, 3], [1, 2, 3]), true);
assert.strictEqual(deepEqual([1, 2, 3], [1, 2, 4]), false);
assert.strictEqual(deepEqual([1, [2, 3]], [1, [2, 3]]), true);
assert.strictEqual(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 }), true);
assert.strictEqual(deepEqual({ a: 1, b: { c: 3 } }, { a: 1, b: { c: 3 } }), true);
assert.strictEqual(deepEqual({ a: 1, b: { c: 3 } }, { a: 1, b: { c: 4 } }), false);
assert.strictEqual(deepEqual({ a: 1 }, { a: 1, b: 2 }), false);
assert.strictEqual(deepEqual([1, 2], [1, 2, 3]), false);
console.log("all tests passed");
