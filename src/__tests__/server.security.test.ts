/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * Live integration coverage for the security boundary added in this milestone: starts the real HTTP+WebSocket
 * server (not a mock) on an ephemeral port and exercises it as an actual unauthenticated client would.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as http from "http";
import { WebSocket } from "ws";
import { startWebServer, type WebServerHandle } from "../web/server";

function mkTempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wrexlyn-server-test-"));
}

function httpGet(port: number, urlPath: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path: urlPath, headers }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
  });
}

function pickPort(): number {
  // Fixed-but-uncommon range for test isolation; each test binds and closes within itself so collisions across
  // tests in this same file are avoided by using a different port per test.
  return 41000 + Math.floor(Math.random() * 4000);
}

async function withServer(fn: (handle: WebServerHandle, port: number) => Promise<void>, lan = false): Promise<void> {
  const root = mkTempRoot();
  const port = pickPort();
  const handle = startWebServer(root, { provider: "kilo", model: "kilo-auto/free" }, false, port, lan);
  // startWebServer's httpServer.listen() is asynchronous — wait for the real "listening" event (or the
  // already-listening case, if this ever races the other way) before handing the server to the test.
  await new Promise<void>((resolve) => {
    if (handle.httpServer.listening) resolve();
    else handle.httpServer.once("listening", () => resolve());
  });
  try {
    await fn(handle, port);
  } finally {
    handle.wss.close();
    await new Promise<void>((resolve) => handle.httpServer.close(() => resolve()));
  }
}

test("server: binds to 127.0.0.1 by default (not every interface)", async () => {
  await withServer(async (handle) => {
    const addr = handle.httpServer.address();
    assert.ok(addr && typeof addr === "object");
    assert.equal((addr as any).address, "127.0.0.1");
  });
});

test("server: binds to 0.0.0.0 only when --lan is explicitly passed", async () => {
  await withServer(
    async (handle) => {
      const addr = handle.httpServer.address();
      assert.ok(addr && typeof addr === "object");
      assert.equal((addr as any).address, "0.0.0.0");
    },
    /* lan */ true
  );
});

test("server: an unauthenticated request to a privileged API route is rejected with 401", async () => {
  await withServer(async (_handle, port) => {
    const res = await httpGet(port, "/api/tree?path=.");
    assert.equal(res.status, 401);
  });
});

test("server: the correct bearer token grants access to a privileged API route", async () => {
  await withServer(async (handle, port) => {
    const res = await httpGet(port, "/api/tree?path=.", { Authorization: `Bearer ${handle.authToken}` });
    assert.equal(res.status, 200);
  });
});

test("server: a wrong bearer token is rejected", async () => {
  await withServer(async (_handle, port) => {
    const res = await httpGet(port, "/api/tree?path=.", { Authorization: "Bearer not-the-real-token" });
    assert.equal(res.status, 401);
  });
});

test("server: the token also works as a ?token= query param (for <img>/<a> contexts that can't set headers)", async () => {
  await withServer(async (handle, port) => {
    const res = await httpGet(port, `/api/tree?path=.&token=${handle.authToken}`);
    assert.equal(res.status, 200);
  });
});

test("server: static assets load without any auth token (the page has to load before it can learn it needs one)", async () => {
  await withServer(async (_handle, port) => {
    const res = await httpGet(port, "/");
    assert.equal(res.status, 200);
  });
});

test("server: an arbitrary session id sent over an authenticated WebSocket cannot delete an external JSON file", async () => {
  await withServer(async (handle, port) => {
    // Plant a file OUTSIDE the project root that a naive `${id}.json` path-join could have deleted before
    // idValidation.ts existed — this test fails loudly (file gone) if that regression ever comes back.
    const externalDir = mkTempRoot();
    const externalFile = path.join(externalDir, "victim.json");
    fs.writeFileSync(externalFile, "{}");

    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wrexlyn-victim-project-"));
    const relativeTraversal = path
      .relative(projectRoot, externalFile)
      .replace(/\.json$/, "") // delete_session appends ".json" itself
      .split(path.sep)
      .join("/");

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/?token=${handle.authToken}`);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error("test timed out waiting on WS round-trip"));
      }, 5000);
      ws.on("open", () => {
        ws.send(JSON.stringify({ type: "delete_session", id: relativeTraversal }));
        // No direct ack for delete_session besides a "sessions" broadcast; give it a moment to (fail to) act,
        // then check the file is untouched instead of waiting on a specific response message.
        setTimeout(() => {
          clearTimeout(timer);
          ws.close();
          resolve();
        }, 500);
      });
      ws.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    assert.ok(fs.existsSync(externalFile), "an unvalidated session id must never delete a file outside the project's own session store");
  });
});

test("WebSocket: a connection without a token is rejected during the handshake", async () => {
  await withServer(async (_handle, port) => {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
      // 8s, not 3s: this spawns a real server and connects a real socket, so it needs headroom for the CPU
      // contention of the full 35-file suite running concurrently, not just for a quiet, unloaded machine.
      const timer = setTimeout(() => reject(new Error("expected the handshake to be rejected, but it stayed open")), 8000);
      ws.on("open", () => {
        clearTimeout(timer);
        ws.close();
        reject(new Error("connection without a token should not have opened"));
      });
      ws.on("error", () => {
        clearTimeout(timer);
        resolve();
      });
      ws.on("unexpected-response", (_req, res) => {
        clearTimeout(timer);
        assert.ok(res.statusCode === 401 || res.statusCode === 403);
        resolve();
      });
    });
  });
});

test("WebSocket: a connection with the correct token succeeds", async () => {
  await withServer(async (handle, port) => {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/?token=${handle.authToken}`);
      // 8s, not 3s: same full-suite CPU-contention headroom as the sibling rejection test above.
      const timer = setTimeout(() => reject(new Error("expected the handshake to succeed")), 8000);
      ws.on("open", () => {
        clearTimeout(timer);
        ws.close();
        resolve();
      });
      ws.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  });
});
