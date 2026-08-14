function sumRange(arr, start, end) {
  let total = 0;
  for (let i = start; i < end; i++) {
    total += arr[i];
  }
  return total;
}

module.exports = { sumRange };
