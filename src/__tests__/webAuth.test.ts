/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { WebAuth, extractBearerToken } from "../webAuth";

test("WebAuth: generates a random, sufficiently long token per instance", () => {
  const a = new WebAuth();
  const b = new WebAuth();
  assert.ok(a.authToken.length >= 32, "token should not be trivially short/guessable");
  assert.notEqual(a.authToken, b.authToken, "two server starts must not share a token");
});

test("WebAuth.checkAuthToken: accepts only the exact token", () => {
  const auth = new WebAuth();
  assert.equal(auth.checkAuthToken(auth.authToken), true);
  assert.equal(auth.checkAuthToken(auth.authToken + "x"), false);
  assert.equal(auth.checkAuthToken(""), false);
  assert.equal(auth.checkAuthToken(undefined), false);
  assert.equal(auth.checkAuthToken(null), false);
});

test("WebAuth pairing: a freshly issued pairing token redeems for the real auth token exactly once", () => {
  const auth = new WebAuth();
  const { token } = auth.issuePairingToken();
  const redeemed = auth.redeemPairingToken(token);
  assert.equal(redeemed, auth.authToken);

  // Single-use: redeeming the same pairing token again must fail.
  const secondAttempt = auth.redeemPairingToken(token);
  assert.equal(secondAttempt, null);
});

test("WebAuth pairing: an expired pairing token cannot be redeemed", async () => {
  const auth = new WebAuth();
  const { token } = auth.issuePairingToken(1); // 1ms TTL
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(auth.redeemPairingToken(token), null);
});

test("WebAuth pairing: a wrong pairing token is rejected without consuming the real one", () => {
  const auth = new WebAuth();
  auth.issuePairingToken();
  assert.equal(auth.redeemPairingToken("not-the-right-token"), null);
});

test("WebAuth pairing: issuing a new pairing token invalidates any previous unused one", () => {
  const auth = new WebAuth();
  const first = auth.issuePairingToken();
  auth.issuePairingToken(); // second call, first.token should now be dead
  assert.equal(auth.redeemPairingToken(first.token), null);
});

test("extractBearerToken: parses a well-formed Authorization header", () => {
  assert.equal(extractBearerToken("Bearer abc123"), "abc123");
  assert.equal(extractBearerToken("bearer abc123"), "abc123");
});

test("extractBearerToken: returns null for missing/malformed headers", () => {
  assert.equal(extractBearerToken(undefined), null);
  assert.equal(extractBearerToken(""), null);
  assert.equal(extractBearerToken("abc123"), null); // missing "Bearer " prefix
  assert.equal(extractBearerToken(["Bearer abc123"]), "abc123");
});
