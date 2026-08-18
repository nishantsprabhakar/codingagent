/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * Curated pptxgenjs helpers for scripts run via the run_pptx_script tool. This file is
 * deliberately NOT under src/ (tsconfig.json only compiles src/**\/*.ts) — it's plain CommonJS,
 * loaded directly by a model-written script via `require('wrexlyn-pptx-kit')`, resolved through
 * the NODE_PATH the run_pptx_script tool sets when spawning the script's process (see
 * shellService.ts's "run_document_script" branch). `require('pptxgenjs')` in this file resolves
 * the same way, against Wrexlyn's own node_modules, not the target project's.
 *
 * Ports the highest-value "design DNA" out of src/tools/documents.ts's create_pptx implementation
 * (the dark-theme-by-default palette, icon badges, shrink-to-fit sidebar text) so a hand-written
 * script doesn't have to reinvent it — see that file's own comments for where each value/technique
 * originally came from (reverse-engineered from a reference deck's raw XML, not estimated).
 */
"use strict";

const path = require("path");
const PptxGenJS = require("pptxgenjs");
// richText.ts/documentIR.ts are compiled TS, not plain-JS assets like this file — load the compiled output.
const { parseInlineMarkup } = require(path.join(__dirname, "..", "dist", "tools", "richText.js"));
const { darkenHex, lightenHex } = require(path.join(__dirname, "..", "dist", "documentIR.js"));

const BODY_FONT = "Calibri";

const ICON_GLYPHS = {
  check: "✓",
  star: "★",
  chart: "📊",
  target: "🎯",
  lock: "🔒",
  warning: "⚠",
  idea: "💡",
  rocket: "🚀",
  gear: "⚙",
  arrow: "→",
  dollar: "💲",
  calendar: "📅",
};

const DARK = {
  bgColor: "0A0E17",
  bodyColor: "8FA0B8",
  titleColor: "F4F7FB",
  zebraColor: "161F30",
  cardBg: "111826",
  cardBorder: "232E45",
  mutedColor: "8FA0B8",
  footerColor: "5F7186",
  sidebarBg: "161F30",
  sidebarBorder: "1B8F87",
};
const LIGHT = {
  bgColor: "FFFFFF",
  bodyColor: "374151",
  titleColor: "1F2937",
  zebraColor: "F3F4F6",
  cardBg: "F8FAFC",
  cardBorder: "E2E8F0",
  mutedColor: "6B7280",
  footerColor: "9CA3AF",
  sidebarBg: "F0F9F8",
  sidebarBorder: null, // derived from accent below
};

const BADGE_COLORS = ["2FE6D9", "FF6B6B", "FFB454", "8B7CFA", "4ADE80"];

/** Converts "**bold** _italic_ __underline__ ~~strike~~" text into a pptxgenjs rich-text run array
 *  (an array of {text, bold?, italic?, underline?, strike?, ...baseOpts} objects), so a script can
 *  pass ordinary marked-up strings to slide.addText() instead of hand-building run arrays. */
function pptxRuns(text, baseOpts) {
  const spans = parseInlineMarkup(String(text ?? ""));
  return spans.map((s) => ({
    text: s.text,
    options: Object.assign({}, baseOpts, {
      bold: s.bold || (baseOpts && baseOpts.bold) || undefined,
      italic: s.italic || (baseOpts && baseOpts.italic) || undefined,
      underline: s.underline ? { style: "sng" } : undefined,
      strike: s.strike ? "sngStrike" : undefined,
    }),
  }));
}

/** Rough estimate of wrapped line count for a plain-text box — sizes a text box tall enough that
 *  PowerPoint's own text wrapping doesn't overflow past it. */
function estimateWrappedLines(text, widthIn, fontSizePt) {
  const avgCharWidthIn = fontSizePt * 0.0092;
  const charsPerLine = Math.max(6, Math.floor(widthIn / avgCharWidthIn));
  const rawLines = String(text ?? "").split("\n");
  return rawLines.reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / charsPerLine)), 0);
}

/**
 * Resolves the full color palette + a set of layout helpers bound to it, mirroring exactly what
 * create_pptx's own run() derives internally. `mode` is "dark" (default) or "light";
 * `accentColor` is an optional 6-digit hex (no '#') overriding the default teal accent.
 */
function createDeckTheme(opts) {
  opts = opts || {};
  const isDark = opts.mode !== "light";
  const palette = isDark ? DARK : LIGHT;
  const accent = (opts.accentColor || "2FE6D9").replace(/^#/, "").toUpperCase();
  const sidebarBorder = palette.sidebarBorder || accent;

  const badgeBg = isDark ? palette.sidebarBg : "FFFFFF";
  const theme = Object.assign({}, palette, { accent, sidebarBorder, badgeBg, badgeColors: BADGE_COLORS, bodyFont: BODY_FONT });

  /** A small emoji glyph centered in a colored circle badge. `onAccentBg` inverts the badge (white
   *  circle, accent glyph) for section-divider slides whose background is already the accent color. */
  theme.addIconBadge = function (slide, icon, x, y, diameterIn, onAccentBg) {
    const glyph = typeof icon === "string" ? ICON_GLYPHS[icon] : undefined;
    if (!glyph) return;
    const circleColor = onAccentBg ? "FFFFFF" : accent;
    const glyphColor = onAccentBg ? accent : "FFFFFF";
    slide.addShape("ellipse", { x, y, w: diameterIn, h: diameterIn, fill: { color: circleColor }, line: { type: "none" } });
    slide.addText(glyph, {
      x, y, w: diameterIn, h: diameterIn, align: "center", valign: "middle",
      fontSize: Math.round(diameterIn * 20), color: glyphColor, margin: 0,
    });
  };

  theme.estimateWrappedLines = estimateWrappedLines;
  theme.pptxRuns = pptxRuns;

  /** Bordered callout panel: kicker + bold title + muted body + optional italic pull-quote, with a
   *  shrink-to-fit font-size loop so long copy never overflows the panel. */
  theme.addSidebar = function (slide, sidebar, x, y, w, h) {
    slide.addShape("roundRect", { x, y, w, h, rectRadius: 0.05, fill: { color: theme.sidebarBg }, line: { color: sidebarBorder, width: 1 } });
    const innerX = x + 0.28;
    const innerW = w - 0.56;
    let cy = y + 0.26;

    if (sidebar.kicker) {
      slide.addText(String(sidebar.kicker).toUpperCase(), {
        x: innerX, y: cy, w: innerW, h: 0.28, fontFace: BODY_FONT, fontSize: 12, bold: true, color: accent, charSpacing: 2,
      });
      cy += 0.36;
    }
    if (sidebar.title) {
      const titleH = estimateWrappedLines(String(sidebar.title), innerW, 18) * 0.34;
      slide.addText(String(sidebar.title), {
        x: innerX, y: cy, w: innerW, h: titleH, fontFace: BODY_FONT, fontSize: 18, bold: true, color: theme.titleColor, valign: "top",
      });
      cy += titleH + 0.16;
    }
    const text = sidebar.text ? String(sidebar.text) : "";
    const quote = sidebar.quote ? String(sidebar.quote) : "";
    if (text || quote) {
      const available = Math.max(0.35, y + h - cy - 0.22);
      const estimate = (fontSize) => {
        const textLines = text ? estimateWrappedLines(text, innerW, fontSize) : 0;
        const quoteLines = quote ? estimateWrappedLines(quote, innerW, fontSize - 1) : 0;
        const gap = text && quote ? 0.16 : 0;
        return textLines * fontSize * 0.0187 + quoteLines * (fontSize - 1) * 0.0187 + gap;
      };
      let fontSize = 12.5;
      while (fontSize > 9 && estimate(fontSize) > available) fontSize -= 0.5;

      if (text) {
        const textH = estimateWrappedLines(text, innerW, fontSize) * fontSize * 0.0187;
        slide.addText(pptxRuns(text, { fontFace: BODY_FONT, fontSize, color: theme.mutedColor }), {
          x: innerX, y: cy, w: innerW, h: textH, valign: "top", lineSpacingMultiple: 1.3,
        });
        cy += textH + (quote ? 0.16 : 0);
      }
      if (quote) {
        const quoteFontSize = fontSize - 1;
        const quoteH = Math.max(0.3, estimateWrappedLines(quote, innerW, quoteFontSize) * quoteFontSize * 0.0187);
        slide.addText(pptxRuns(quote, { fontFace: BODY_FONT, fontSize: quoteFontSize, color: theme.titleColor }), {
          x: innerX, y: cy, w: innerW, h: quoteH, valign: "top", italic: true, lineSpacingMultiple: 1.3,
        });
      }
    }
  };

  /** {title, caption} bullet items — a colored dot, bold title, muted caption beneath — the
   *  closing/CTA "next steps" pattern. */
  theme.isDotListItems = function (bullets) {
    return Array.isArray(bullets) && bullets.length > 0 && bullets.every((b) => b && typeof b === "object" && !Array.isArray(b) && typeof b.title === "string");
  };

  theme.renderDotList = function (slide, items, x, y, w) {
    let cy = y;
    for (const item of items) {
      const rowH = item.caption ? 0.72 : 0.45;
      slide.addShape("ellipse", { x, y: cy + 0.08, w: 0.16, h: 0.16, fill: { color: accent }, line: { type: "none" } });
      slide.addText(String(item.title || ""), { x: x + 0.32, y: cy, w: w - 0.32, h: 0.35, fontFace: BODY_FONT, fontSize: 15, bold: true, color: theme.titleColor });
      if (item.caption) {
        slide.addText(String(item.caption), { x: x + 0.32, y: cy + 0.33, w: w - 0.32, h: 0.3, fontFace: BODY_FONT, fontSize: 11.5, color: theme.mutedColor });
      }
      cy += rowH;
    }
  };

  /** Base IChartOpts styling matching create_pptx's own chart presets — a script does
   *  `slide.addChart(pres.ChartType.bar, data, Object.assign(theme.chartDefaults("categorical"), {x, y, w, h}))`,
   *  then overrides/adds anything this deliberately-simple preset doesn't cover (combo series,
   *  custom axis formatting, etc.) — full addChart/IChartOpts access is retained, this just seeds
   *  the theme-consistent defaults. `kind`: "categorical" (bar/line) or "circular" (pie/doughnut). */
  theme.chartDefaults = function (kind) {
    const shared = {
      chartColors: [accent, ...BADGE_COLORS],
      titleColor: theme.titleColor,
      titleFontFace: BODY_FONT,
    };
    if (kind === "circular") {
      return Object.assign({}, shared, {
        showLegend: true, legendPos: "r", legendColor: theme.mutedColor, legendFontFace: BODY_FONT,
        showPercent: true, dataLabelColor: "FFFFFF", dataLabelFontFace: BODY_FONT,
      });
    }
    return Object.assign({}, shared, {
      showLegend: true, legendPos: "b", legendColor: theme.mutedColor, legendFontFace: BODY_FONT,
      showValue: true, dataLabelPosition: "outEnd", dataLabelColor: theme.bodyColor, dataLabelFontFace: BODY_FONT,
      catAxisLabelColor: theme.mutedColor, catAxisLabelFontFace: BODY_FONT,
      valAxisLabelColor: theme.mutedColor, valAxisLabelFontFace: BODY_FONT,
      valGridLine: { color: theme.cardBorder, size: 0.75 },
      catGridLine: { style: "none" },
    });
    // Deliberately never sets barGrouping:"stacked" here — dataLabelPosition "outEnd" above corrupts
    // a *stacked* bar/column chart (must be ctr/inEnd/inBase there). If a script needs a stacked
    // chart, override dataLabelPosition explicitly rather than relying on this preset as-is.
  };

  /** pptxgenjs-ready header/body table row arrays reproducing create_pptx's own table styling, so a
   *  script's addTable call looks consistent without reimplementing the shading/zebra logic. `cells`
   *  is an array of plain strings; `tableBodyRow`'s `rowIndex` drives zebra striping and
   *  `opts.highlight` overrides it with an accent-tinted fill (e.g. for a "Total" row). */
  theme.tableHeaderRow = function (cells) {
    return cells.map((c) => ({
      text: isDark ? String(c ?? "").toUpperCase() : String(c ?? ""),
      options: { bold: true, fontSize: 13.5, color: isDark ? accent : "FFFFFF", fill: { color: isDark ? theme.cardBg : accent } },
    }));
  };

  theme.tableBodyRow = function (cells, rowIndex, opts) {
    const highlight = opts && opts.highlight;
    const highlightFill = isDark ? darkenHex(accent, 0.75) : lightenHex(accent, 0.75);
    return cells.map((c) => ({
      text: String(c ?? ""),
      options: {
        fontSize: 13,
        bold: highlight || undefined,
        color: theme.bodyColor,
        fill: { color: highlight ? highlightFill : rowIndex % 2 === 1 ? theme.zebraColor : theme.bgColor },
      },
    }));
  };

  /** Bordered label/caption boxes in a row — `"compact"` matches the `cover` layout's bottom-strip
   *  treatment; `"large"` fills the given box with bigger, bolder callouts for a standalone stats
   *  slide. Mirrors create_pptx's own renderStatsRow exactly. */
  theme.renderStatsRow = function (slide, stats, x, y, w, h, size) {
    if (!stats || !stats.length) return;
    const gap = size === "large" ? 0.2 : 0.16;
    const boxW = (w - gap * (stats.length - 1)) / stats.length;
    const boxH = size === "large" ? h : 0.78;
    const labelSize = size === "large" ? 15 : 12.5;
    const captionSize = size === "large" ? 12.5 : 10;
    const flagW = size === "large" ? 0.06 : 0.045;
    stats.forEach((s, i) => {
      const sx = x + i * (boxW + gap);
      slide.addShape("rect", { x: sx, y, w: boxW, h: boxH, fill: { color: theme.cardBg }, line: { color: theme.cardBorder, width: 0.75 } });
      slide.addShape("rect", { x: sx, y, w: flagW, h: boxH, fill: { color: accent }, line: { type: "none" } });
      const labelY = size === "large" ? y + boxH * 0.32 : y + 0.1;
      slide.addText(String((s && s.label) || "").toUpperCase(), {
        x: sx + 0.2, y: labelY, w: boxW - 0.32, h: 0.4, fontFace: BODY_FONT, fontSize: labelSize, bold: true, color: accent, valign: "top",
      });
      slide.addText(String((s && s.caption) || ""), {
        x: sx + 0.2, y: labelY + 0.4, w: boxW - 0.32, h: boxH - (labelY - y) - 0.4, fontFace: BODY_FONT, fontSize: captionSize, color: theme.mutedColor, valign: "top",
      });
    });
  };

  /** Numbered badge circles connected by a horizontal line — a process/sequence flow, deliberately
   *  without a card background (unlike `cards`) so it reads as a connected flow, not freestanding
   *  boxes. Mirrors create_pptx's own renderTimeline exactly. */
  theme.renderTimeline = function (slide, steps, x, y, w, h) {
    if (!steps || !steps.length) return;
    const gap = 0.16;
    const colW = (w - gap * (steps.length - 1)) / steps.length;
    const badgeD = 0.56;
    const badgeCy = y + badgeD / 2;
    if (steps.length > 1) {
      const fromX = x + colW / 2;
      const toX = x + (steps.length - 1) * (colW + gap) + colW / 2;
      slide.addShape("line", { x: fromX, y: y + badgeD / 2, w: toX - fromX, h: 0, line: { color: theme.cardBorder, width: 1.5 } });
    }
    steps.forEach((s, i) => {
      const cx = x + i * (colW + gap);
      const badgeColor = BADGE_COLORS[i % BADGE_COLORS.length];
      const badgeX = cx + (colW - badgeD) / 2;
      slide.addShape("ellipse", { x: badgeX, y, w: badgeD, h: badgeD, fill: { color: theme.badgeBg }, line: { color: badgeColor, width: 1.5 } });
      const glyph = s && typeof s.icon === "string" ? ICON_GLYPHS[s.icon] : undefined;
      slide.addText(glyph || String(i + 1), {
        x: badgeX, y, w: badgeD, h: badgeD, align: "center", valign: "middle", fontFace: BODY_FONT, fontSize: glyph ? 18 : 15, bold: true, color: badgeColor,
      });
      slide.addText(String((s && s.label) || ""), {
        x: cx, y: badgeCy + badgeD / 2 + 0.14, w: colW, h: 0.4, align: "center", fontFace: BODY_FONT, fontSize: 13.5, bold: true, color: theme.titleColor,
      });
      if (s && s.caption) {
        slide.addText(String(s.caption), {
          x: cx, y: badgeCy + badgeD / 2 + 0.5, w: colW, h: h - (badgeCy + badgeD / 2 + 0.5 - y), align: "center", valign: "top", fontFace: BODY_FONT, fontSize: 11, color: theme.mutedColor,
        });
      }
    });
  };

  return theme;
}

module.exports = { PptxGenJS, ICON_GLYPHS, BODY_FONT, createDeckTheme, pptxRuns, estimateWrappedLines };
