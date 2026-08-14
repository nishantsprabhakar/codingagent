const assert = require("assert");
const { Stack } = require("./stack.js");

const s = new Stack();
assert.strictEqual(s.isEmpty(), true);
assert.strictEqual(s.size(), 0);
assert.strictEqual(s.pop(), undefined);
assert.strictEqual(s.peek(), undefined);

s.push(1);
s.push(2);
s.push(3);
assert.strictEqual(s.size(), 3);
assert.strictEqual(s.isEmpty(), false);
assert.strictEqual(s.peek(), 3);
assert.strictEqual(s.pop(), 3);
assert.strictEqual(s.pop(), 2);
assert.strictEqual(s.size(), 1);
assert.strictEqual(s.pop(), 1);
assert.strictEqual(s.isEmpty(), true);
console.log("all tests passed");
