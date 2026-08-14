async function sequentialMap(items, asyncFn) {
  // TODO: implement -- must run one at a time, never concurrently
  return Promise.all(items.map(asyncFn));
}

module.exports = { sequentialMap };
