/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * SSRF-hardened outbound HTTP(S) fetch for the web_fetch tool. Deliberately
 * built on Node's raw http/https modules rather than the global `fetch()` —
 * `fetch()` resolves DNS and follows redirects internally, which is exactly
 * the part that needs to be intercepted:
 *
 * - The hostname is resolved to its literal IP address(es) *before*
 *   connecting, and every resolved address is checked against
 *   ipSafety.ts's blocklist — not just the hostname string. A hostname an
 *   attacker controls (or a model was steered toward via content it just
 *   fetched) can't be blocked by a hostname-string check, since DNS can
 *   point anywhere; it can be blocked by checking what it actually resolves
 *   to.
 * - The request connects to that pre-validated literal IP directly (not the
 *   hostname), with the original hostname preserved via the `Host` header
 *   and TLS SNI (`servername`) so virtual hosting and certificate
 *   validation still work correctly. This closes the DNS-rebinding window
 *   entirely — there is no second, separate DNS lookup between validation
 *   and connection for an attacker to race.
 * - Redirects are followed manually, one hop at a time, with the exact same
 *   resolve-then-validate-then-connect sequence repeated for every hop and
 *   an overall cap on hop count — a redirect to a blocked address is
 *   rejected exactly like a direct request to one would be.
 * - Response bytes are capped during streaming, and — separately — bytes
 *   *after* decompression are also capped, so a small compressed response
 *   can't be used to exhaust memory by expanding to something enormous
 *   once decompressed.
 */
import * as http from "http";
import * as https from "https";
import * as zlib from "zlib";
import * as dns from "dns";
import { Transform } from "stream";
import { isBlockedAddress } from "./ipSafety";
import { WrexlynError } from "../errors";

export class SafeFetchError extends WrexlynError {}

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export interface SafeFetchResult {
  status: number;
  statusText: string;
  /** The final URL after following any redirects. */
  url: string;
  headers: Record<string, string>;
  text(): Promise<string>;
}

export interface SafeFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxRedirects?: number;
  maxResponseBytes?: number;
  signal?: AbortSignal;
  /** Test-only injection point — defaults to a real dns.lookup. Never set this in production code. */
  resolveHost?: (hostname: string) => Promise<ResolvedAddress[]>;
  /** Test-only injection point — defaults to the real ipSafety blocklist. Never set this in production code. */
  isAddressAllowed?: (address: string) => boolean;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024; // 10MB — ample for any text/HTML/JSON page this tool needs to read
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

async function defaultResolveHost(hostname: string): Promise<ResolvedAddress[]> {
  const results = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  return results.map((r) => ({ address: r.address, family: r.family as 4 | 6 }));
}

/** A Transform that errors out the stream once more than `limit` bytes have passed through it. */
class ByteLimiter extends Transform {
  private total = 0;
  constructor(private readonly limit: number, private readonly label: string) {
    super();
  }
  _transform(chunk: Buffer, _enc: string, callback: (err?: Error | null, data?: Buffer) => void): void {
    this.total += chunk.length;
    if (this.total > this.limit) {
      callback(new SafeFetchError(`${this.label} exceeded the ${this.limit}-byte limit`, "RESPONSE_TOO_LARGE"));
      return;
    }
    callback(null, chunk);
  }
}

/** Resolves `hostname`, validates every resolved address, and returns the first one to connect to. Throws SafeFetchError if any resolved address is blocked, or none resolve. */
async function resolveAndValidate(
  hostname: string,
  resolveHost: (h: string) => Promise<ResolvedAddress[]>,
  isAddressAllowed: (a: string) => boolean
): Promise<ResolvedAddress> {
  let resolved: ResolvedAddress[];
  try {
    resolved = await resolveHost(hostname);
  } catch (err: any) {
    throw new SafeFetchError(`Could not resolve "${hostname}": ${err.message ?? err}`, "DNS_ERROR");
  }
  if (!resolved.length) {
    throw new SafeFetchError(`"${hostname}" did not resolve to any address.`, "DNS_EMPTY");
  }
  // Conservative by design: if ANY resolved address (e.g. one of several A/AAAA records) is blocked, refuse the
  // whole hostname rather than gamble on which address the connection ends up using.
  for (const r of resolved) {
    if (!isAddressAllowed(r.address)) {
      throw new SafeFetchError(
        `"${hostname}" resolves to ${r.address}, which is a local/private/reserved address. Refusing to connect.`,
        "BLOCKED_ADDRESS"
      );
    }
  }
  return resolved[0];
}

function collectResponse(
  res: http.IncomingMessage,
  maxResponseBytes: number
): Promise<{ status: number; statusText: string; headers: Record<string, string>; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(res.headers)) headers[k] = Array.isArray(v) ? v.join(", ") : v ?? "";

    const encoding = (headers["content-encoding"] ?? "").toLowerCase();
    let stream: NodeJS.ReadableStream = res;
    // Node's http module (unlike fetch) never auto-decompresses — do it manually, with the byte cap applied
    // to the *decompressed* output, not just the raw bytes over the wire, so a small gzip/deflate/br response
    // can't expand into a memory-exhausting one once decoded.
    if (encoding === "gzip" || encoding === "x-gzip") stream = stream.pipe(zlib.createGunzip());
    else if (encoding === "deflate") stream = stream.pipe(zlib.createInflate());
    else if (encoding === "br") stream = stream.pipe(zlib.createBrotliDecompress());

    const limiter = new ByteLimiter(maxResponseBytes, "Response body");
    stream = stream.pipe(limiter);

    const chunks: Buffer[] = [];
    stream.on("data", (c: Buffer) => chunks.push(c));
    stream.on("end", () =>
      resolve({ status: res.statusCode ?? 0, statusText: res.statusMessage ?? "", headers, body: Buffer.concat(chunks) })
    );
    stream.on("error", (err) => {
      res.destroy();
      reject(err);
    });
  });
}

export async function safeFetch(inputUrl: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const maxResponseBytes = opts.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const resolveHost = opts.resolveHost ?? defaultResolveHost;
  const isAddressAllowed = opts.isAddressAllowed ?? ((address: string) => !isBlockedAddress(address));

  const deadline = Date.now() + timeoutMs;

  let currentUrl = new URL(inputUrl);
  let redirectsFollowed = 0;

  while (true) {
    if (currentUrl.protocol !== "http:" && currentUrl.protocol !== "https:") {
      throw new SafeFetchError(`Unsupported protocol "${currentUrl.protocol}" — only http:// and https:// are allowed.`, "BAD_PROTOCOL");
    }

    const resolved = await resolveAndValidate(currentUrl.hostname, resolveHost, isAddressAllowed);

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new SafeFetchError(`Request timed out after ${timeoutMs}ms.`, "TIMEOUT");

    const transport = currentUrl.protocol === "https:" ? https : http;
    const port = currentUrl.port ? Number(currentUrl.port) : currentUrl.protocol === "https:" ? 443 : 80;

    const response = await new Promise<{ status: number; statusText: string; headers: Record<string, string>; body: Buffer }>(
      (resolve, reject) => {
        const req = transport.request(
          {
            hostname: resolved.address,
            family: resolved.family,
            port,
            path: currentUrl.pathname + currentUrl.search,
            method: opts.method ?? "GET",
            // Pinning the connection to the pre-validated literal IP (not the hostname) is what closes the
            // DNS-rebinding window — there's no second lookup here for an attacker to race. Host/servername
            // keep virtual hosting and TLS certificate validation targeting the real hostname.
            servername: currentUrl.protocol === "https:" ? currentUrl.hostname : undefined,
            headers: { Host: currentUrl.host, ...opts.headers },
            timeout: remainingMs,
          },
          (res) => {
            collectResponse(res, maxResponseBytes).then(resolve, reject);
          }
        );
        req.on("timeout", () => req.destroy(new SafeFetchError(`Request timed out after ${timeoutMs}ms.`, "TIMEOUT")));
        req.on("error", (err) => reject(err instanceof SafeFetchError ? err : new SafeFetchError(err.message, "REQUEST_ERROR")));
        opts.signal?.addEventListener("abort", () => req.destroy(new SafeFetchError("Request aborted.", "ABORTED")));
        req.end();
      }
    );

    const location = response.headers["location"];
    if (REDIRECT_STATUSES.has(response.status) && location) {
      redirectsFollowed++;
      if (redirectsFollowed > maxRedirects) {
        throw new SafeFetchError(`Too many redirects (>${maxRedirects}) fetching ${inputUrl}.`, "TOO_MANY_REDIRECTS");
      }
      currentUrl = new URL(location, currentUrl);
      continue;
    }

    const finalUrl = currentUrl.toString();
    return {
      status: response.status,
      statusText: response.statusText,
      url: finalUrl,
      headers: response.headers,
      text: async () => response.body.toString("utf-8"),
    };
  }
}
