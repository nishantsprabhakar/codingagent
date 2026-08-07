/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
import type { ToolSpec } from "../types";

const MAX_OUTPUT_CHARS = 20_000;
const FETCH_TIMEOUT_MS = 15_000;
const USER_AGENT = "Wrexlyn/0.1 (+https://github.com/nishantsprabhakar/codingagent)";

/**
 * Literal-hostname SSRF guard. This isn't DNS-rebinding-proof (that would need
 * an actual dns.lookup + IP-range check), but it stops the obvious case of the
 * model being steered — by content it just fetched — into hitting the user's
 * own local services (e.g. this very agent's web UI) or link-local metadata
 * endpoints, which is the realistic risk for a tool that runs without a
 * permission prompt.
 */
const BLOCKED_HOSTNAMES = new Set(["localhost", "0.0.0.0", "::1"]);
function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(h)) return true;
  if (/^127\./.test(h)) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  if (/^\[?fe80:/i.test(h) || /^\[?::1\]?$/.test(h)) return true;
  return false;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const webFetchTool: ToolSpec = {
  mutating: false,
  definition: {
    type: "function",
    function: {
      name: "web_fetch",
      description:
        "Fetch a URL from the internet and return its readable text content (HTML is stripped to plain text; " +
        "JSON/plain text is returned as-is). Use this to look up current documentation, API references, or any " +
        "information you don't already know. Only http(s) URLs are supported; requests to local/private network " +
        "addresses are refused.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "The full URL to fetch, including https://" },
        },
        required: ["url"],
      },
    },
  },
  describe: (args) => `fetch ${args.url}`,
  run: async (args) => {
    let parsed: URL;
    try {
      parsed = new URL(String(args.url));
    } catch {
      return { ok: false, output: `"${args.url}" is not a valid URL.` };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { ok: false, output: `Unsupported protocol "${parsed.protocol}" — only http:// and https:// are allowed.` };
    }
    if (isBlockedHost(parsed.hostname)) {
      return { ok: false, output: `Refusing to fetch "${parsed.hostname}" — local/private network addresses are blocked.` };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(parsed.toString(), {
        signal: controller.signal,
        redirect: "follow",
        headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/json,text/plain,*/*" },
      });

      if (!res.ok) {
        return { ok: false, output: `HTTP ${res.status} ${res.statusText} fetching ${parsed.toString()}` };
      }

      const contentType = res.headers.get("content-type") ?? "";
      const raw = await res.text();
      const text = contentType.includes("html") ? stripHtml(raw) : raw.trim();

      const truncated = text.length > MAX_OUTPUT_CHARS;
      const body = truncated ? text.slice(0, MAX_OUTPUT_CHARS) : text;
      const note = truncated ? `\n\n... (truncated, ${text.length} total characters)` : "";
      return { ok: true, output: `[${res.status}] ${res.url || parsed.toString()}\n\n${body || "(empty response)"}${note}` };
    } catch (err: any) {
      if (err.name === "AbortError") {
        return { ok: false, output: `Request to ${parsed.toString()} timed out after ${FETCH_TIMEOUT_MS / 1000}s.` };
      }
      return { ok: false, output: `Failed to fetch ${parsed.toString()}: ${err.message ?? err}` };
    } finally {
      clearTimeout(timer);
    }
  },
};
