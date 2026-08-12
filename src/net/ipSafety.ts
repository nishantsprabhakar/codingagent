/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * IP-literal classification for the SSRF guard in safeFetch.ts: is this
 * address loopback, private, link-local (which covers every major cloud
 * provider's 169.254.169.254 metadata endpoint), multicast, or otherwise
 * reserved, for IPv4 and IPv6 alike. Built on Node's own `net.BlockList`
 * (stable since Node 15) rather than hand-rolled bitwise/regex range
 * checks — it already gets IPv4-mapped IPv6 normalization right (verified:
 * checking "::ffff:127.0.0.1" against an IPv4 127.0.0.0/8 subnet with
 * family "ipv6" correctly returns true), which is exactly the kind of
 * detail a regex-based check tends to get wrong.
 *
 * This module only classifies IP *literals*. It has no opinion on hostnames
 * — resolving a hostname to the literal(s) checked here is safeFetch.ts's
 * job, done once before connecting and again on every redirect hop.
 */
import { BlockList, isIPv4, isIPv6 } from "net";

const blockList = new BlockList();

/** IPv4 ranges that must never be reachable from a "fetch this URL for me" tool with no permission prompt. */
const IPV4_BLOCKED_SUBNETS: Array<[string, number]> = [
  ["0.0.0.0", 8], // "this network" / unspecified
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // shared address space (CGNAT)
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local — includes 169.254.169.254, the cloud metadata endpoint on AWS/Azure/GCP/most providers
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1 (documentation)
  ["192.88.99.0", 24], // deprecated 6to4 relay anycast
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2 (documentation)
  ["203.0.113.0", 24], // TEST-NET-3 (documentation)
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, including 255.255.255.255 broadcast
];

/** IPv6 equivalents, plus the IPv6-specific ranges IPv4 has no analog for. */
const IPV6_BLOCKED_SUBNETS: Array<[string, number]> = [
  ["::1", 128], // loopback
  ["::", 128], // unspecified
  ["100::", 64], // discard-only
  ["64:ff9b::", 96], // NAT64 well-known prefix — embeds an IPv4 address that may itself be private, don't let the wrapper hide it
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4 — embeds an IPv4 address
  ["fc00::", 7], // unique local (the IPv6 analog of RFC1918 private space)
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
];

for (const [subnet, prefix] of IPV4_BLOCKED_SUBNETS) blockList.addSubnet(subnet, prefix, "ipv4");
for (const [subnet, prefix] of IPV6_BLOCKED_SUBNETS) blockList.addSubnet(subnet, prefix, "ipv6");

/**
 * True if `address` (a literal IP, not a hostname) must not be connected to.
 * Any string that isn't a recognizable IPv4/IPv6 literal is treated as
 * blocked — callers are expected to have already resolved a hostname to a
 * literal before reaching this check, so a non-literal here means something
 * upstream is wrong, not that the address is safe by default.
 */
export function isBlockedAddress(address: string): boolean {
  if (isIPv4(address)) return blockList.check(address, "ipv4");
  if (isIPv6(address)) return blockList.check(address, "ipv6");
  return true;
}
