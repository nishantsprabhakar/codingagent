/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as http from "http";
import * as zlib from "zlib";
import { safeFetch, SafeFetchError } from "../net/safeFetch";
import { isBlockedAddress } from "../net/ipSafety";

/** Starts a plain local HTTP server on an ephemeral port for the duration of one test. */
function startTestServer(handler: http.RequestListener): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ port, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

/** For tests: treats the local test server's own loopback address as allowed, but otherwise defers to the
 *  real production blocklist — so a redirect to a genuinely blocked address is still genuinely rejected. */
const allowLoopbackOnly = (address: string) => address === "127.0.0.1" || !isBlockedAddress(address);

async function expectSafeFetchError(fn: () => Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(fn, (err: any) => {
    assert.ok(err instanceof SafeFetchError, `expected a SafeFetchError, got ${err?.constructor?.name}: ${err?.message}`);
    assert.equal(err.code, code, `expected error code ${code}, got ${err.code} (${err.message})`);
    return true;
  });
}

test("safeFetch: rejects a literal loopback address before attempting to connect", async () => {
  // Nothing listens on port 1 — if this ever tried to actually connect, it would fail with ECONNREFUSED, a
  // different error than BLOCKED_ADDRESS. Getting BLOCKED_ADDRESS specifically proves the check ran first.
  await expectSafeFetchError(() => safeFetch("http://127.0.0.1:1/"), "BLOCKED_ADDRESS");
});

test("safeFetch: rejects a private IPv4 literal directly in the URL", async () => {
  await expectSafeFetchError(() => safeFetch("http://10.0.0.5:1/"), "BLOCKED_ADDRESS");
});

test("safeFetch: rejects the cloud metadata address directly in the URL", async () => {
  await expectSafeFetchError(() => safeFetch("http://169.254.169.254/latest/meta-data/"), "BLOCKED_ADDRESS");
});

test("safeFetch: rejects a hostname whose (injected) DNS resolution is a private address — the DNS-rebinding case", async () => {
  await expectSafeFetchError(
    () =>
      safeFetch("http://internal.example/", {
        resolveHost: async () => [{ address: "10.1.2.3", family: 4 }],
      }),
    "BLOCKED_ADDRESS"
  );
});

test("safeFetch: rejects a hostname with an injected IPv6 unique-local resolution", async () => {
  await expectSafeFetchError(
    () =>
      safeFetch("http://internal-v6.example/", {
        resolveHost: async () => [{ address: "fd00::1", family: 6 }],
      }),
    "BLOCKED_ADDRESS"
  );
});

test("safeFetch: rejects a hostname if ANY of its resolved addresses is blocked, even if another is public", async () => {
  await expectSafeFetchError(
    () =>
      safeFetch("http://multi-a-record.example/", {
        resolveHost: async () => [
          { address: "8.8.8.8", family: 4 },
          { address: "127.0.0.1", family: 4 },
        ],
      }),
    "BLOCKED_ADDRESS"
  );
});

test("safeFetch: rejects non-http(s) protocols before any resolution or connection", async () => {
  await expectSafeFetchError(() => safeFetch("ftp://example.com/file.txt"), "BAD_PROTOCOL");
  await expectSafeFetchError(() => safeFetch("file:///etc/passwd"), "BAD_PROTOCOL");
});

test("safeFetch: succeeds against a local test server once its address is explicitly allow-listed", async () => {
  const server = await startTestServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("hello from test server");
  });
  try {
    const res = await safeFetch(`http://allowed-test-host:${server.port}/`, {
      resolveHost: async () => [{ address: "127.0.0.1", family: 4 }],
      isAddressAllowed: allowLoopbackOnly,
    });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "hello from test server");
  } finally {
    await server.close();
  }
});

test("safeFetch: follows a redirect from one allowed server to another and returns the final response", async () => {
  const target = await startTestServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("final destination");
  });
  const origin = await startTestServer((_req, res) => {
    res.writeHead(302, { Location: `http://allowed-test-host-2:${target.port}/` });
    res.end();
  });
  try {
    const res = await safeFetch(`http://allowed-test-host-1:${origin.port}/`, {
      resolveHost: async (hostname) =>
        hostname === "allowed-test-host-1" || hostname === "allowed-test-host-2"
          ? [{ address: "127.0.0.1", family: 4 }]
          : [],
      isAddressAllowed: allowLoopbackOnly,
    });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "final destination");
    assert.ok(res.url.includes(String(target.port)), "final url should reflect the redirect target");
  } finally {
    await origin.close();
    await target.close();
  }
});

test("safeFetch: rejects a redirect to a blocked address even when the initial host was allowed", async () => {
  const origin = await startTestServer((_req, res) => {
    res.writeHead(302, { Location: "http://169.254.169.254/latest/meta-data/" });
    res.end();
  });
  try {
    await expectSafeFetchError(
      () =>
        safeFetch(`http://allowed-test-host:${origin.port}/`, {
          resolveHost: async (hostname) =>
            hostname === "allowed-test-host" ? [{ address: "127.0.0.1", family: 4 }] : [{ address: "169.254.169.254", family: 4 }],
          isAddressAllowed: allowLoopbackOnly,
        }),
      "BLOCKED_ADDRESS"
    );
  } finally {
    await origin.close();
  }
});

test("safeFetch: enforces a maximum redirect count", async () => {
  const server = await startTestServer((req, res) => {
    // Every request redirects to itself — an infinite redirect loop unless the hop cap kicks in.
    res.writeHead(302, { Location: req.url ?? "/" });
    res.end();
  });
  try {
    await expectSafeFetchError(
      () =>
        safeFetch(`http://allowed-test-host:${server.port}/`, {
          resolveHost: async () => [{ address: "127.0.0.1", family: 4 }],
          isAddressAllowed: allowLoopbackOnly,
          maxRedirects: 3,
        }),
      "TOO_MANY_REDIRECTS"
    );
  } finally {
    await server.close();
  }
});

test("safeFetch: enforces a response size cap on the raw (uncompressed) body", async () => {
  const server = await startTestServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("x".repeat(10_000));
  });
  try {
    await expectSafeFetchError(
      () =>
        safeFetch(`http://allowed-test-host:${server.port}/`, {
          resolveHost: async () => [{ address: "127.0.0.1", family: 4 }],
          isAddressAllowed: allowLoopbackOnly,
          maxResponseBytes: 1_000,
        }),
      "RESPONSE_TOO_LARGE"
    );
  } finally {
    await server.close();
  }
});

test("safeFetch: enforces the size cap on the DECOMPRESSED body, not just the bytes on the wire (decompression-bomb protection)", async () => {
  const server = await startTestServer((_req, res) => {
    // A small gzip payload that expands to something far larger than the cap — a real decompression bomb
    // pattern, just at test-friendly scale (a few hundred KB compresses trivially well since it's all zeros).
    const huge = Buffer.alloc(2_000_000, 0);
    const compressed = zlib.gzipSync(huge);
    res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Encoding": "gzip" });
    res.end(compressed);
  });
  try {
    await expectSafeFetchError(
      () =>
        safeFetch(`http://allowed-test-host:${server.port}/`, {
          resolveHost: async () => [{ address: "127.0.0.1", family: 4 }],
          isAddressAllowed: allowLoopbackOnly,
          maxResponseBytes: 100_000, // far smaller than the 2MB decompressed size, comfortably larger than the compressed size on the wire
        }),
      "RESPONSE_TOO_LARGE"
    );
  } finally {
    await server.close();
  }
});

test("safeFetch: a real response smaller than the cap round-trips gzip decompression correctly", async () => {
  const server = await startTestServer((_req, res) => {
    const payload = Buffer.from("hello, this is a small gzip-compressed response");
    const compressed = zlib.gzipSync(payload);
    res.writeHead(200, { "Content-Type": "text/plain", "Content-Encoding": "gzip" });
    res.end(compressed);
  });
  try {
    const res = await safeFetch(`http://allowed-test-host:${server.port}/`, {
      resolveHost: async () => [{ address: "127.0.0.1", family: 4 }],
      isAddressAllowed: allowLoopbackOnly,
    });
    assert.equal(await res.text(), "hello, this is a small gzip-compressed response");
  } finally {
    await server.close();
  }
});
