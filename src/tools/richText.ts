/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * A small, LLM-friendly inline markup subset shared by the Word and
 * PowerPoint generators, so a model can write "**Revenue** grew _12%_ this
 * quarter" as plain text and get real bold/italic runs — instead of needing
 * to construct nested per-run JSON, which weaker models handle unreliably.
 * Plain text with no markup produces a single unstyled span, so every
 * existing caller that just passes plain strings keeps working unchanged.
 */

export interface RichSpan {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
}

type StyleKey = "bold" | "italic" | "underline" | "strike";

/** Order matters: two-character delimiters (**, __, ~~) must be matched before the single-character _italic_. */
const RULES: Array<{ re: RegExp; style: StyleKey }> = [
  { re: /\*\*(.+?)\*\*/gs, style: "bold" },
  { re: /__(.+?)__/gs, style: "underline" },
  { re: /~~(.+?)~~/gs, style: "strike" },
  { re: /_(.+?)_/gs, style: "italic" },
];

function applyRule(spans: RichSpan[], re: RegExp, style: StyleKey): RichSpan[] {
  const result: RichSpan[] = [];
  for (const span of spans) {
    const text = span.text;
    let lastIndex = 0;
    let matchedAny = false;
    let match: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((match = re.exec(text))) {
      matchedAny = true;
      if (match.index > lastIndex) result.push({ ...span, text: text.slice(lastIndex, match.index) });
      result.push({ ...span, [style]: true, text: match[1] });
      lastIndex = match.index + match[0].length;
    }
    if (!matchedAny) result.push(span);
    else if (lastIndex < text.length) result.push({ ...span, text: text.slice(lastIndex) });
  }
  return result;
}

/** Parses "**bold** _italic_ __underline__ ~~strike~~" (combinable, e.g. "**_bold italic_**") into styled spans. */
export function parseInlineMarkup(raw: string): RichSpan[] {
  let spans: RichSpan[] = [{ text: raw ?? "" }];
  for (const rule of RULES) spans = applyRule(spans, rule.re, rule.style);
  return spans.filter((s) => s.text.length > 0);
}

/** Strips markup delimiters without applying any styling — for contexts (e.g. table-of-contents-free plain summaries) that can't render rich text. */
export function stripInlineMarkup(raw: string): string {
  return parseInlineMarkup(raw)
    .map((s) => s.text)
    .join("");
}

const HEX_RE = /^[0-9a-fA-F]{6}$/;

/** Normalizes a user-supplied hex color (with or without '#'), falling back to `fallback` if it isn't valid 6-digit hex. */
export function normalizeHexColor(input: string | undefined, fallback: string): string {
  if (!input) return fallback;
  const cleaned = input.trim().replace(/^#/, "");
  return HEX_RE.test(cleaned) ? cleaned.toUpperCase() : fallback;
}
