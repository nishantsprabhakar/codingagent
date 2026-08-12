/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
import type { ToolSpec } from "../types";
import { safeFetch, SafeFetchError } from "../net/safeFetch";

const MAX_OUTPUT_CHARS = 20_000;
const FETCH_TIMEOUT_MS = 15_000;
const USER_AGENT = "Wrexlyn/0.1 (+https://github.com/nishantsprabhakar/codingagent)";

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

    try {
      // safeFetch (src/net/safeFetch.ts) resolves the hostname, validates every resolved address against
      // ipSafety.ts's blocklist, connects to the pre-validated literal IP directly, and re-validates on every
      // redirect hop — see that module's header comment for why a hostname-string check alone isn't enough.
      const res = await safeFetch(parsed.toString(), {
        timeoutMs: FETCH_TIMEOUT_MS,
        headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/json,text/plain,*/*" },
      });

      if (res.status < 200 || res.status >= 300) {
        return { ok: false, output: `HTTP ${res.status} ${res.statusText} fetching ${parsed.toString()}` };
      }

      const contentType = res.headers["content-type"] ?? "";
      const raw = await res.text();
      const text = contentType.includes("html") ? stripHtml(raw) : raw.trim();

      const truncated = text.length > MAX_OUTPUT_CHARS;
      const body = truncated ? text.slice(0, MAX_OUTPUT_CHARS) : text;
      const note = truncated ? `\n\n... (truncated, ${text.length} total characters)` : "";
      return { ok: true, output: `[${res.status}] ${res.url || parsed.toString()}\n\n${body || "(empty response)"}${note}` };
    } catch (err: any) {
      if (err instanceof SafeFetchError && err.code === "TIMEOUT") {
        return { ok: false, output: `Request to ${parsed.toString()} timed out after ${FETCH_TIMEOUT_MS / 1000}s.` };
      }
      if (err instanceof SafeFetchError && err.code === "BLOCKED_ADDRESS") {
        return { ok: false, output: `Refusing to fetch "${parsed.hostname}" — it resolves to a local/private/reserved address.` };
      }
      return { ok: false, output: `Failed to fetch ${parsed.toString()}: ${err.message ?? err}` };
    }
  },
};
