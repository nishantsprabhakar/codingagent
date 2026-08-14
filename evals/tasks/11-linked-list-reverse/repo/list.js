function fromArray(values) {
  let head = null;
  for (let i = values.length - 1; i >= 0; i--) {
    head = { value: values[i], next: head };
  }
  return head;
}

function toArray(head) {
  const out = [];
  let node = head;
  while (node) {
    out.push(node.value);
    node = node.next;
  }
  return out;
}

function reverse(head) {
  // TODO: implement
  return head;
}

module.exports = { fromArray, toArray, reverse };
