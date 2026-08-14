const assert = require("assert");
const { evaluate } = require("./evaluate.js");

assert.strictEqual(evaluate("2 + 3"), 5);
assert.strictEqual(evaluate("2 + 3 * 4"), 14);
assert.strictEqual(evaluate("(2 + 3) * 4"), 20);
assert.strictEqual(evaluate("10 - 2 - 3"), 5);
assert.strictEqual(evaluate("2 * (3 + (4 - 1))"), 12);
assert.strictEqual(evaluate("8 / 4 / 2"), 1);
assert.strictEqual(evaluate("100"), 100);
assert.strictEqual(evaluate("1 + 2 * (3 + 4) - 5"), 10);
console.log("all tests passed");
