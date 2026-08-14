const assert = require("assert");
const { isValidEmail } = require("./validate.js");

assert.strictEqual(isValidEmail("a@b.com"), true);
assert.strictEqual(isValidEmail("first.last@example.co.uk"), true);
assert.strictEqual(isValidEmail("nope"), false);
assert.strictEqual(isValidEmail("no-at-sign.com"), false);
assert.strictEqual(isValidEmail("two@@signs.com"), false);
assert.strictEqual(isValidEmail("has space@example.com"), false);
assert.strictEqual(isValidEmail("no-dot@example"), false);
assert.strictEqual(isValidEmail("@example.com"), false);
console.log("all tests passed");
