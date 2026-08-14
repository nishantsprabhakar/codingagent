const assert = require("assert");
const { unique } = require("./unique.js");

assert.deepStrictEqual(unique([1, 2, 2, 3, 1, 4]), [1, 2, 3, 4]);
assert.deepStrictEqual(unique(["a", "b", "a", "c"]), ["a", "b", "c"]);
assert.deepStrictEqual(unique([]), []);
assert.deepStrictEqual(unique([5]), [5]);
console.log("all tests passed");
