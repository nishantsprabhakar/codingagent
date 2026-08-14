/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * OAuth 2.1 client support for remote (Streamable HTTP) MCP servers.
 *
 * The SDK's `StreamableHTTPClientTransport` drives the whole auth flow itself when constructed
 * with an `OAuthClientProvider` — it reads `redirectUrl` synchronously while building the
 * authorization URL, calls `redirectToAuthorization()` *inside* `connect()`/`start()`, and only
 * then throws `UnauthorizedError` back to the caller. That means the loopback callback listener
 * and the provider both have to exist *before* `connect()` is ever called — there is no later
 * "now actually kick off the redirect" hook to gate on for a single call site. The `interactive`
 * flag on the provider itself is what decides whether `redirectToAuthorization` actually opens a
 * browser (an explicit "Sign in" attempt) or just records the URL for the caller to show/log (a
 * passive background reconnect that shouldn't pop a browser window unprompted).
 */
import * as crypto from "crypto";
import * as http from "http";
import { spawn } from "child_process";
import { getSecretStore } from "./secretStore";

interface OAuthTokens {
  access_token: string;
  token_type: string;
  expires_in?: number;
  scope?: string;
  refresh_token?: string;
  [key: string]: unknown;
}

interface OAuthClientInformation {
  client_id: string;
  client_secret?: string;
  [key: string]: unknown;
}

// Matches the subset of the SDK's OAuthClientProvider interface this app actually implements.
// The SDK type itself isn't imported (same CJS/ESM subpath-resolution workaround as mcp.ts) --
// StreamableHTTPClientTransport only needs an object satisfying this shape at the call site.
export interface OAuthClientProviderLike {
  readonly redirectUrl: string;
  readonly clientMetadata: Record<string, unknown>;
  clientInformation(): OAuthClientInformation | undefined | Promise<OAuthClientInformation | undefined>;
  saveClientInformation(info: OAuthClientInformation): void | Promise<void>;
  tokens(): OAuthTokens | undefined | Promise<OAuthTokens | undefined>;
  saveTokens(tokens: OAuthTokens): void | Promise<void>;
  redirectToAuthorization(authorizationUrl: URL): void | Promise<void>;
  saveCodeVerifier(codeVerifier: string): void | Promise<void>;
  codeVerifier(): string | Promise<string>;
  state(): string | Promise<string>;
}

function secretAccountFor(kind: "client" | "tokens", serverName: string): string {
  return `mcp-oauth-${kind}:${serverName}`;
}

/**
 * One instance per authorization attempt. `interactive` gates whether `redirectToAuthorization`
 * opens a real browser window (an explicit user-triggered "Sign in") or only records the URL (a
 * passive background connect attempt, which must never surprise the user with a popped browser tab).
 * `onAuthorizationUrl` is always invoked either way, so the caller can surface the URL as a
 * copy-paste fallback (headless environments, or CLI) regardless of whether a browser opened.
 */
export class WrexlynOAuthProvider implements OAuthClientProviderLike {
  private codeVerifierValue: string | undefined;
  private stateValue: string | undefined;

  constructor(
    private readonly serverName: string,
    public readonly redirectUrl: string,
    private readonly interactive: boolean,
    private readonly onAuthorizationUrl: (url: string) => void
  ) {}

  get clientMetadata(): Record<string, unknown> {
    return {
      client_name: "Wrexlyn",
      redirect_uris: [this.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  async clientInformation(): Promise<OAuthClientInformation | undefined> {
    const raw = await (await getSecretStore()).get(secretAccountFor("client", this.serverName));
    if (!raw) return undefined;
    try {
      return JSON.parse(raw);
    } catch {
      return undefined; // corrupt entry -- treat as never-registered, not fatal
    }
  }

  async saveClientInformation(info: OAuthClientInformation): Promise<void> {
    await (await getSecretStore()).set(secretAccountFor("client", this.serverName), JSON.stringify(info));
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    const raw = await (await getSecretStore()).get(secretAccountFor("tokens", this.serverName));
    if (!raw) return undefined;
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await (await getSecretStore()).set(secretAccountFor("tokens", this.serverName), JSON.stringify(tokens));
  }

  /** Not part of every consumer's usage, but implemented so the CSRF `state` check in the callback
   * listener has something real to validate against -- it's optional in the SDK's interface, and an
   * unimplemented `state()` would silently mean no `state` param is ever sent at all. */
  state(): string {
    this.stateValue = crypto.randomBytes(16).toString("hex");
    return this.stateValue;
  }

  /** Not part of the SDK's OAuthClientProvider interface -- this app's own addition, read by the
   * callback listener to validate the `state` query param on the redirect. */
  getExpectedState(): string | undefined {
    return this.stateValue;
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    const url = String(authorizationUrl);
    this.onAuthorizationUrl(url);
    if (this.interactive) openUrlInBrowser(url);
  }

  saveCodeVerifier(codeVerifier: string): void {
    this.codeVerifierValue = codeVerifier;
  }

  codeVerifier(): string {
    if (!this.codeVerifierValue) throw new Error("No PKCE code verifier saved for this authorization attempt.");
    return this.codeVerifierValue;
  }
}

/** Best-effort: opens the user's default browser. The URL always also reaches the caller as plain
 * text via `onAuthorizationUrl`, so a failure here (or a headless environment with no browser at
 * all) never blocks completing sign-in by copy-pasting the link instead. Uses an argument array,
 * never a shell-concatenated string -- the URL comes from a semi-trusted authorization server. */
export function openUrlInBrowser(url: string): void {
  try {
    if (process.platform === "win32") {
      spawn("cmd", ["/c", "start", "", url], { stdio: "ignore", detached: true }).unref();
    } else if (process.platform === "darwin") {
      spawn("open", [url], { stdio: "ignore", detached: true }).unref();
    } else {
      spawn("xdg-open", [url], { stdio: "ignore", detached: true }).unref();
    }
  } catch {
    // best effort only -- the URL is always also surfaced as text
  }
}

export interface OAuthCallbackListener {
  /** The ephemeral port this listener bound to -- part of the redirect URI the provider advertises. */
  port: number;
  /** Resolves with the authorization code once a valid callback arrives, or rejects on timeout /
   * a state mismatch. Always closes the underlying HTTP server before settling either way. */
  waitForCode(expectedState: string | undefined, timeoutMs: number): Promise<string>;
  /** Closes the listener immediately without waiting -- used for the non-interactive path, where
   * nothing will ever call `waitForCode()` because no browser was opened. */
  close(): void;
}

/**
 * Starts a loopback-only (127.0.0.1, never "localhost" -- avoids IPv6 ::1 resolution ambiguity on
 * Windows) HTTP listener on an OS-assigned ephemeral port, for exactly one OAuth redirect. Must be
 * started, and its port read, before constructing the provider/transport -- the SDK reads
 * `redirectUrl` synchronously during `connect()`, with no async setup hook of its own.
 */
export function startOAuthCallbackListener(): Promise<OAuthCallbackListener> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    let settled = false;

    server.on("error", (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Failed to determine the OAuth callback listener's port."));
        return;
      }
      const port = address.port;

      const waitForCode = (expectedState: string | undefined, timeoutMs: number): Promise<string> => {
        return new Promise((resolveCode, rejectCode) => {
          let done = false;
          const finish = (fn: () => void) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            server.close();
            fn();
          };
          const timer = setTimeout(() => {
            finish(() => rejectCode(new Error("Timed out waiting for the OAuth sign-in to complete.")));
          }, timeoutMs);

          server.on("request", (req, res) => {
            const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
            if (url.pathname !== "/callback") {
              res.writeHead(404).end();
              return;
            }
            const code = url.searchParams.get("code");
            const state = url.searchParams.get("state");
            if (!code || state !== expectedState) {
              res.writeHead(400, { "Content-Type": "text/html" }).end(
                "<html><body>Sign-in failed: missing or mismatched authorization response. You can close this tab and try again.</body></html>"
              );
              finish(() => rejectCode(new Error("OAuth callback was missing a code, or its state did not match -- rejecting as a possible CSRF attempt.")));
              return;
            }
            res.writeHead(200, { "Content-Type": "text/html" }).end(
              "<html><body>Signed in. You can close this tab and return to Wrexlyn.</body></html>"
            );
            finish(() => resolveCode(code));
          });
        });
      };

      resolve({
        port,
        waitForCode,
        close: () => server.close(),
      });
      settled = true;
    });
  });
}
