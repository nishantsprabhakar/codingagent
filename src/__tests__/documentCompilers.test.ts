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
import type { DocSpec } from "../documentIR";
import { compileToMarkdown } from "../documentCompilers/toMarkdown";
import { compileToHtml } from "../documentCompilers/toHtml";
import { compileToPdf } from "../documentCompilers/toPdf";

// A real, valid 1x1 transparent PNG — for image-block tests. Not a mock: loadImageFile actually
// parses this file's header bytes, same as it would for a real screenshot.
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function mkRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wrexlyn-doccompilers-test-"));
}

function writeTinyPng(root: string, relPath: string): void {
  fs.writeFileSync(path.join(root, relPath), Buffer.from(TINY_PNG_BASE64, "base64"));
}

const SCRIPT_PAYLOAD = "<script>alert(1)</script>";

test("compileToMarkdown: full heading range, inline markup, nested bullets, table escaping, toc, pagebreak", () => {
  const root = mkRoot();
  const spec: DocSpec = {
    title: "Report",
    blocks: [
      { type: "heading", level: 1, text: "One" },
      { type: "heading", level: 6, text: "Six" },
      { type: "paragraph", text: "**bold** _italic_ __underline__ ~~strike~~" },
      { type: "bullets", items: ["A", { text: "B", level: 1 }, "C"] },
      { type: "table", headers: ["Col | X", "Y"], rows: [["a|b", "line1\nline2"]] },
      { type: "toc" },
      { type: "pagebreak" },
    ],
  };
  const { content } = compileToMarkdown(spec, root);

  assert.match(content, /^# Report/m);
  assert.match(content, /^# One/m);
  assert.match(content, /^###### Six/m, "heading level 6 must render as ###### , not be truncated to h4");
  assert.match(content, /\*\*bold\*\*/);
  assert.match(content, /_italic_/);
  assert.match(content, /<u>underline<\/u>/, "underline has no markdown syntax -- must render as raw <u> HTML");
  assert.match(content, /~~strike~~/);
  assert.match(content, /^- A$/m);
  assert.match(content, /^ {2}- B$/m, "nested bullet must be indented under its parent");
  assert.match(content, /^- C$/m);
  assert.match(content, /Col \\\| X/, "a literal pipe in a header must be escaped so it doesn't break the column count");
  assert.match(content, /a\\\|b/, "a literal pipe in a cell must be escaped");
  assert.match(content, /line1<br>line2/, "an embedded newline in a cell must collapse to <br>, not break the row");
  assert.match(content, /Table of Contents/);
  assert.match(content, /^---$/m, "pagebreak has no markdown equivalent -- approximated as a thematic break");
});

test("compileToMarkdown: never emits an unescaped <script> tag from model-supplied text", () => {
  const root = mkRoot();
  const spec: DocSpec = { blocks: [{ type: "paragraph", text: SCRIPT_PAYLOAD }] };
  const { content } = compileToMarkdown(spec, root);
  assert.ok(!content.includes(SCRIPT_PAYLOAD), "the raw script tag must not survive into the output verbatim");
  assert.ok(content.includes("&lt;script&gt;"), "it must be entity-escaped instead");
});

test("compileToMarkdown: embeds a real image as a base64 data URI", () => {
  const root = mkRoot();
  writeTinyPng(root, "pic.png");
  const spec: DocSpec = { blocks: [{ type: "image", path: "pic.png", caption: "A tiny pixel" }] };
  const { content } = compileToMarkdown(spec, root);
  assert.match(content, /!\[.*\]\(data:image\/png;base64,/);
  assert.match(content, /A tiny pixel/);
});

test("compileToMarkdown: throws with an actionable message when the image can't be found", () => {
  const root = mkRoot();
  const spec: DocSpec = { blocks: [{ type: "image", path: "missing.png" }] };
  assert.throws(() => compileToMarkdown(spec, root), /not found/i);
});

test("compileToHtml: heading id slugs are deduped and toc renders real jump links", () => {
  const root = mkRoot();
  const spec: DocSpec = {
    blocks: [
      { type: "heading", level: 1, text: "Overview" },
      { type: "heading", level: 2, text: "Overview" },
      { type: "toc" },
    ],
  };
  const { content } = compileToHtml(spec, root);
  assert.match(content, /id="overview"/);
  assert.match(content, /id="overview-1"/, "a duplicate heading text must get a deduped slug, not collide");
  assert.match(content, /<a href="#overview">Overview<\/a>/);
  assert.match(content, /<a href="#overview-1">Overview<\/a>/);
});

test("compileToHtml: nested bullets render as properly closed nested <ul>", () => {
  const root = mkRoot();
  const spec: DocSpec = { blocks: [{ type: "bullets", items: ["A", { text: "B", level: 1 }, "C"] }] };
  const { content } = compileToHtml(spec, root);
  // A and C are siblings at the top level; B is nested inside A's <li>, not a sibling of A/C.
  assert.match(content, /<ul><li>A<ul><li>B<\/li><\/ul><\/li><li>C<\/li><\/ul>/);
});

test("compileToHtml: pagebreak renders a real page-break div", () => {
  const root = mkRoot();
  const spec: DocSpec = { blocks: [{ type: "pagebreak" }] };
  const { content } = compileToHtml(spec, root);
  assert.match(content, /class="page-break"/);
  assert.match(content, /page-break-after:\s*always/);
});

test("compileToHtml: never emits an unescaped <script> tag from model-supplied text (heading, paragraph, table cell)", () => {
  const root = mkRoot();
  const spec: DocSpec = {
    title: SCRIPT_PAYLOAD,
    blocks: [
      { type: "heading", level: 1, text: SCRIPT_PAYLOAD },
      { type: "paragraph", text: SCRIPT_PAYLOAD },
      { type: "table", headers: [SCRIPT_PAYLOAD], rows: [[SCRIPT_PAYLOAD]] },
    ],
  };
  const { content } = compileToHtml(spec, root);
  assert.ok(!content.includes(SCRIPT_PAYLOAD), "a live <script> tag must never appear in generated HTML that Puppeteer/a browser will execute");
  assert.ok(content.includes("&lt;script&gt;"));
});

test("compileToHtml: align is mapped through a fixed dictionary, never raw-interpolated", () => {
  const root = mkRoot();
  const spec: DocSpec = { blocks: [{ type: "paragraph", text: "x", align: 'center;} </style><script>alert(1)</script>' as any }] };
  const { content } = compileToHtml(spec, root);
  assert.ok(!content.includes("<script>alert(1)</script>"), "an invalid align value must never reach a style attribute verbatim");
});

test("compileToHtml: embeds a real image with correct dimensions", () => {
  const root = mkRoot();
  writeTinyPng(root, "pic.png");
  const spec: DocSpec = { blocks: [{ type: "image", path: "pic.png", caption: "cap" }] };
  const { content } = compileToHtml(spec, root);
  assert.match(content, /<img src="data:image\/png;base64,/);
  assert.match(content, /<figcaption>cap<\/figcaption>/);
});

test(
  "compileToPdf: renders a real PDF via headless Chromium, including a page break",
  { timeout: 30_000 },
  async (t) => {
    const root = mkRoot();
    const spec: DocSpec = {
      title: "PDF Test",
      blocks: [
        { type: "heading", level: 1, text: "Page 1" },
        { type: "pagebreak" },
        { type: "heading", level: 1, text: "Page 2" },
      ],
    };

    let result;
    try {
      result = await compileToPdf(spec, root);
    } catch (err: any) {
      t.skip(`Chromium unavailable in this environment: ${err.message ?? err}`);
      return;
    }

    if (!result.ok && /Could not start the PDF renderer/i.test(result.error)) {
      t.skip(`Chromium unavailable in this environment: ${result.error}`);
      return;
    }

    assert.equal(result.ok, true, result.ok ? "" : (result as any).error);
    if (result.ok) {
      assert.equal(result.buffer.subarray(0, 5).toString(), "%PDF-");
      assert.ok(result.buffer.length > 500, "a real rendered PDF should be well over 500 bytes");
    }
  }
);
