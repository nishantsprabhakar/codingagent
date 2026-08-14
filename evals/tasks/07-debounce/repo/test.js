const assert = require("assert");
const { debounce } = require("./debounce.js");

let callCount = 0;
let lastArg = null;
const debounced = debounce((arg) => {
  callCount++;
  lastArg = arg;
}, 40);

debounced("first");
debounced("second");
debounced("third");

assert.strictEqual(callCount, 0, "must not call fn synchronously");

setTimeout(() => {
  assert.strictEqual(callCount, 1, "fn must be called exactly once after the wait period");
  assert.strictEqual(lastArg, "third", "fn must be called with the arguments of the LAST call");
  console.log("all tests passed");
}, 100);
