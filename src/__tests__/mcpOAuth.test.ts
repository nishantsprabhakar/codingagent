/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as http from "http";
import { WrexlynOAuthProvider, startOAuthCallbackListener } from "../mcpOAuth";
import { _setBaseDirForTesting, _resetSecretStoreForTesting } from "../secretStore";

function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wrexlyn-mcpoauth-test-"));
  _setBaseDirForTesting(dir);
  _resetSecretStoreForTesting();
  return fn(dir).finally(() => {
    _setBaseDirForTesting(null);
    _resetSecretStoreForTesting();
  });
}

test("WrexlynOAuthProvider: client information and tokens round-trip through the real secretStore", async () => {
  await withTempDir(async () => {
    const provider = new WrexlynOAuthProvider("test-server", "http://127.0.0.1:1/callback", false, () => {});

    assert.equal(await provider.clientInformation(), undefined);
    await provider.saveClientInformation({ client_id: "abc123" });
    assert.deepEqual(await provider.clientInformation(), { client_id: "abc123" });

    assert.equal(await provider.tokens(), undefined);
    await provider.saveTokens({ access_token: "tok", token_type: "Bearer" });
    assert.deepEqual(await provider.tokens(), { access_token: "tok", token_type: "Bearer" });
  });
});

test("WrexlynOAuthProvider: client info and tokens are namespaced per server -- one server's data never leaks into another's", async () => {
  await withTempDir(async () => {
    const a = new WrexlynOAuthProvider("server-a", "http://127.0.0.1:1/callback", false, () => {});
    const b = new WrexlynOAuthProvider("server-b", "http://127.0.0.1:1/callback", false, () => {});
    await a.saveTokens({ access_token: "a-token", token_type: "Bearer" });
    assert.equal(await b.tokens(), undefined);
    assert.deepEqual(await a.tokens(), { access_token: "a-token", token_type: "Bearer" });
  });
});

test("WrexlynOAuthProvider: state() returns a fresh nonce each authorization attempt, matched by getExpectedState()", () => {
  const provider = new WrexlynOAuthProvider("s", "http://127.0.0.1:1/callback", false, () => {});
  const state1 = provider.state();
  assert.equal(provider.getExpectedState(), state1);
  const state2 = provider.state();
  assert.equal(provider.getExpectedState(), state2);
  assert.notEqual(state1, state2);
});

test("WrexlynOAuthProvider: codeVerifier() throws until saveCodeVerifier() has been called for this attempt", () => {
  const provider = new WrexlynOAuthProvider("s", "http://127.0.0.1:1/callback", false, () => {});
  assert.throws(() => provider.codeVerifier());
  provider.saveCodeVerifier("verifier-value");
  assert.equal(provider.codeVerifier(), "verifier-value");
});

test("WrexlynOAuthProvider: redirectToAuthorization always reports the URL via the callback, regardless of interactive", () => {
  const seen: string[] = [];
  const nonInteractive = new WrexlynOAuthProvider("s", "http://127.0.0.1:1/callback", false, (url) => seen.push(url));
  nonInteractive.redirectToAuthorization(new URL("https://auth.example.com/authorize?foo=bar"));
  assert.deepEqual(seen, ["https://auth.example.com/authorize?foo=bar"]);
});

test("WrexlynOAuthProvider: clientMetadata advertises a public client with PKCE and this app's redirect URL", () => {
  const provider = new WrexlynOAuthProvider("s", "http://127.0.0.1:5555/callback", false, () => {});
  const metadata = provider.clientMetadata as any;
  assert.equal(metadata.token_endpoint_auth_method, "none");
  assert.deepEqual(metadata.redirect_uris, ["http://127.0.0.1:5555/callback"]);
  assert.ok(metadata.grant_types.includes("authorization_code"));
});

test("startOAuthCallbackListener: waitForCode resolves with the code when state matches", async () => {
  const listener = await startOAuthCallbackListener();
  assert.ok(listener.port > 0);

  const promise = listener.waitForCode("expected-state", 5000);
  const res = await httpGet(`http://127.0.0.1:${listener.port}/callback?code=abc123&state=expected-state`);
  assert.equal(res.status, 200);
  assert.equal(await promise, "abc123");
});

test("startOAuthCallbackListener: rejects a callback whose state does not match (CSRF defense)", async () => {
  const listener = await startOAuthCallbackListener();
  const promise = listener.waitForCode("expected-state", 5000);
  // The rejection handler must attach in the same tick the promise is created (via Promise.all)
  // -- awaiting the HTTP round-trip first would leave `promise` rejected-but-unhandled for a beat,
  // which node:test's runner treats as a failure even though the eventual assertion would pass.
  const [, res] = await Promise.all([
    assert.rejects(promise),
    httpGet(`http://127.0.0.1:${listener.port}/callback?code=abc123&state=WRONG`),
  ]);
  assert.equal(res.status, 400);
});

test("startOAuthCallbackListener: rejects a callback with no state at all when one was expected", async () => {
  const listener = await startOAuthCallbackListener();
  const promise = listener.waitForCode("expected-state", 5000);
  await Promise.all([assert.rejects(promise), httpGet(`http://127.0.0.1:${listener.port}/callback?code=abc123`)]);
});

test("startOAuthCallbackListener: close() before any callback arrives tears down the server without hanging", async () => {
  const listener = await startOAuthCallbackListener();
  listener.close();
  // A second close() must not throw either -- both the non-interactive early-close path and the
  // interactive finally-block close() can legitimately run against an already-closed listener.
  assert.doesNotThrow(() => listener.close());
});

function httpGet(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let body = "";
        res.on("data", (d) => (body += d));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      })
      .on("error", reject);
  });
}
