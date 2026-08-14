const assert = require("assert");
const { fromArray, toArray, reverse } = require("./list.js");

assert.deepStrictEqual(toArray(reverse(fromArray([1, 2, 3, 4]))), [4, 3, 2, 1]);
assert.deepStrictEqual(toArray(reverse(fromArray([1]))), [1]);
assert.deepStrictEqual(toArray(reverse(fromArray([]))), []);
assert.deepStrictEqual(toArray(reverse(fromArray([1, 2]))), [2, 1]);
console.log("all tests passed");
