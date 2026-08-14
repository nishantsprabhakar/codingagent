const assert = require("assert");
const { sequentialMap } = require("./sequentialMap.js");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  let active = 0;
  let maxActive = 0;
  const order = [];

  const results = await sequentialMap([1, 2, 3], async (n) => {
    active++;
    maxActive = Math.max(maxActive, active);
    order.push(`start-${n}`);
    await delay(15);
    order.push(`end-${n}`);
    active--;
    return n * 10;
  });

  assert.deepStrictEqual(results, [10, 20, 30], "results must be in the same order as items");
  assert.strictEqual(maxActive, 1, "must never run more than one call concurrently");
  assert.deepStrictEqual(
    order,
    ["start-1", "end-1", "start-2", "end-2", "start-3", "end-3"],
    "each call must fully finish before the next one starts"
  );
  console.log("all tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
