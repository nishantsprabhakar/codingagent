const assert = require("assert");
const { capitalizeWords } = require("./strings.js");

assert.strictEqual(capitalizeWords("hello world"), "Hello World");
assert.strictEqual(capitalizeWords("a"), "A");
assert.strictEqual(capitalizeWords("multiple   spaces"), "Multiple   Spaces");
assert.strictEqual(capitalizeWords(""), "");
console.log("all tests passed");
