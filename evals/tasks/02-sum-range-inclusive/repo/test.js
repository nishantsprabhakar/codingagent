const assert = require("assert");
const { sumRange } = require("./range.js");

assert.strictEqual(sumRange([1, 2, 3, 4, 5], 0, 4), 15);
assert.strictEqual(sumRange([1, 2, 3, 4, 5], 1, 3), 9);
assert.strictEqual(sumRange([10, 20, 30], 0, 0), 10);
assert.strictEqual(sumRange([10, 20, 30], 2, 2), 30);
console.log("all tests passed");
