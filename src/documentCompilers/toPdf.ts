/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * Compiles the shared DocSpec to a PDF buffer by rendering it to HTML (toHtml.ts) and printing that
 * HTML through headless Chromium (puppeteer) — the explicit tradeoff accepted for this phase: real
 * CSS layout/page-break fidelity, at the cost of `puppeteer` being a `dependencies` addition that
 * downloads a bundled Chromium (~170-300MB) on every install of this product, not just PDF users.
 */
import puppeteer from "puppeteer";
import type { DocSpec } from "../documentIR";
import { compileToHtml } from "./toHtml";

const CLOSE_TIMEOUT_MS = 10_000;

/** Races browser.close() against a short timeout and force-kills the underlying process if it never
 *  settles — scripts/run-tests.js's --test-force-exit only rescues a test run AFTER a test reports
 *  its result; if close() itself hangs, the test never gets that far, so the timeout has to live here. */
async function closeWithTimeout(browser: import("puppeteer").Browser): Promise<void> {
  let timedOut = false;
  const timeout = new Promise<void>((resolve) => {
    setTimeout(() => {
      timedOut = true;
      resolve();
    }, CLOSE_TIMEOUT_MS);
  });
  await Promise.race([browser.close(), timeout]);
  if (timedOut) {
    try {
      browser.process()?.kill("SIGKILL");
    } catch {
      // best-effort
    }
  }
}

export interface CompileToPdfResult {
  ok: true;
  buffer: Buffer;
  warnings: string[];
}
export interface CompileToPdfError {
  ok: false;
  error: string;
}

/**
 * Compiles a DocSpec to a PDF buffer. Never throws — launch failures (missing Chromium, no network
 * access during install, sandboxed environment) are caught and rephrased into an actionable
 * {ok:false} result rather than an unhandled crash, since this is a real failure mode in a
 * restricted/offline install environment, not hypothetical.
 */
export async function compileToPdf(spec: DocSpec, root: string): Promise<CompileToPdfResult | CompileToPdfError> {
  let html: string;
  let warnings: string[];
  try {
    const compiled = compileToHtml(spec, root, { forPrint: true });
    html = compiled.content;
    warnings = compiled.warnings;
  } catch (err: any) {
    return { ok: false, error: err.message ?? String(err) };
  }

  let browser: import("puppeteer").Browser;
  try {
    browser = await puppeteer.launch();
  } catch (err: any) {
    return {
      ok: false,
      error: `Could not start the PDF renderer (headless Chromium): ${err.message ?? err}. Check that Chromium downloaded successfully during "npm install" and that this machine allows launching it.`,
    };
  }

  try {
    const page = await browser.newPage();
    await page.setContent(html); // self-contained HTML (base64-embedded images) — no network wait needed
    const buffer = await page.pdf({ format: "A4", printBackground: true, margin: { top: "0.6in", bottom: "0.6in", left: "0.6in", right: "0.6in" } });
    return { ok: true, buffer: Buffer.from(buffer), warnings };
  } catch (err: any) {
    return { ok: false, error: `PDF rendering failed: ${err.message ?? err}` };
  } finally {
    await closeWithTimeout(browser);
  }
}
