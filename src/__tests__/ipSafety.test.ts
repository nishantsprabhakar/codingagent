/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isBlockedAddress } from "../net/ipSafety";

test("isBlockedAddress: blocks IPv4 loopback", () => {
  assert.equal(isBlockedAddress("127.0.0.1"), true);
  assert.equal(isBlockedAddress("127.255.255.254"), true);
});

test("isBlockedAddress: blocks IPv4 private ranges (RFC1918)", () => {
  assert.equal(isBlockedAddress("10.0.0.1"), true);
  assert.equal(isBlockedAddress("10.255.255.255"), true);
  assert.equal(isBlockedAddress("172.16.0.1"), true);
  assert.equal(isBlockedAddress("172.31.255.255"), true);
  assert.equal(isBlockedAddress("192.168.0.1"), true);
  assert.equal(isBlockedAddress("192.168.255.255"), true);
});

test("isBlockedAddress: blocks the cloud-metadata link-local address and its whole /16", () => {
  assert.equal(isBlockedAddress("169.254.169.254"), true); // AWS/Azure/GCP metadata endpoint
  assert.equal(isBlockedAddress("169.254.0.1"), true);
});

test("isBlockedAddress: blocks IPv4 multicast, CGNAT, and documentation/reserved ranges", () => {
  assert.equal(isBlockedAddress("224.0.0.1"), true); // multicast
  assert.equal(isBlockedAddress("100.64.0.1"), true); // shared address space
  assert.equal(isBlockedAddress("192.0.2.1"), true); // TEST-NET-1
  assert.equal(isBlockedAddress("198.51.100.1"), true); // TEST-NET-2
  assert.equal(isBlockedAddress("203.0.113.1"), true); // TEST-NET-3
  assert.equal(isBlockedAddress("240.0.0.1"), true); // reserved
  assert.equal(isBlockedAddress("255.255.255.255"), true); // broadcast
  assert.equal(isBlockedAddress("0.0.0.0"), true); // unspecified
});

test("isBlockedAddress: allows genuinely public IPv4 addresses", () => {
  assert.equal(isBlockedAddress("8.8.8.8"), false); // Google DNS
  assert.equal(isBlockedAddress("1.1.1.1"), false); // Cloudflare DNS
  assert.equal(isBlockedAddress("93.184.216.34"), false); // example.com's old address, still a plain public IP
});

test("isBlockedAddress: blocks IPv6 loopback and unspecified", () => {
  assert.equal(isBlockedAddress("::1"), true);
  assert.equal(isBlockedAddress("::"), true);
});

test("isBlockedAddress: blocks IPv6 unique-local (ULA) and link-local", () => {
  assert.equal(isBlockedAddress("fc00::1"), true);
  assert.equal(isBlockedAddress("fd00::1"), true); // fd00::/8 is inside fc00::/7
  assert.equal(isBlockedAddress("fe80::1"), true);
  assert.equal(isBlockedAddress("fe80::abcd:1234"), true);
});

test("isBlockedAddress: blocks the AWS IPv6 metadata address (falls inside fd00::/8 ULA space)", () => {
  assert.equal(isBlockedAddress("fd00:ec2::254"), true);
});

test("isBlockedAddress: blocks IPv6 multicast and documentation ranges", () => {
  assert.equal(isBlockedAddress("ff02::1"), true); // multicast
  assert.equal(isBlockedAddress("2001:db8::1"), true); // documentation
});

test("isBlockedAddress: blocks an IPv4-mapped IPv6 address whose embedded IPv4 is blocked", () => {
  // This is the case a naive implementation gets wrong: the outer address is technically IPv6,
  // but it wraps a private/loopback IPv4 address and must be blocked exactly as if it were the plain IPv4 form.
  assert.equal(isBlockedAddress("::ffff:127.0.0.1"), true);
  assert.equal(isBlockedAddress("::ffff:10.0.0.1"), true);
  assert.equal(isBlockedAddress("::ffff:169.254.169.254"), true);
});

test("isBlockedAddress: allows an IPv4-mapped IPv6 address whose embedded IPv4 is public", () => {
  assert.equal(isBlockedAddress("::ffff:8.8.8.8"), false);
});

test("isBlockedAddress: allows a genuinely public IPv6 address", () => {
  assert.equal(isBlockedAddress("2606:4700:4700::1111"), false); // Cloudflare DNS
  assert.equal(isBlockedAddress("2001:4860:4860::8888"), false); // Google DNS
});

test("isBlockedAddress: treats a non-IP-literal string as blocked (conservative default)", () => {
  assert.equal(isBlockedAddress("not-an-ip"), true);
  assert.equal(isBlockedAddress("example.com"), true);
  assert.equal(isBlockedAddress(""), true);
});
