const assert = require("assert");
const { LRUCache } = require("./lru.js");

const cache = new LRUCache(2);
cache.put(1, "a");
cache.put(2, "b");
assert.strictEqual(cache.get(1), "a");

cache.put(3, "c"); // capacity 2, key 2 was least-recently-used (1 was just accessed) -> evict 2
assert.strictEqual(cache.get(2), undefined);
assert.strictEqual(cache.get(1), "a");
assert.strictEqual(cache.get(3), "c");

cache.put(4, "d"); // now key 1 is least-recently-used (3 then... let's check order: get(1), get(3) just happened) -> evict 1
assert.strictEqual(cache.get(1), undefined);
assert.strictEqual(cache.get(3), "c");
assert.strictEqual(cache.get(4), "d");

cache.put(3, "updated"); // updating an existing key must also refresh recency
assert.strictEqual(cache.get(3), "updated");

console.log("all tests passed");
