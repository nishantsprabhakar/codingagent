const assert = require("assert");
const { parseCsv } = require("./csv.js");

const input = "name,age\nAlice,30\nBob,25\n";
assert.deepStrictEqual(parseCsv(input), [
  { name: "Alice", age: "30" },
  { name: "Bob", age: "25" },
]);

const withSpaces = "a, b\n1, 2\n";
assert.deepStrictEqual(parseCsv(withSpaces), [{ a: "1", b: "2" }]);

assert.deepStrictEqual(parseCsv("only,header\n"), []);
console.log("all tests passed");
