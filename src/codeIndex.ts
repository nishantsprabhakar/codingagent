/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * Phase 5 "project intelligence" engine: an incremental file/symbol index plus ranked lexical
 * (keyword) search over the working directory. Deliberately no semantic/embedding retrieval and no
 * AST parser — both explicit, discussed scope decisions (see
 * docs/architecture/2026-08-phase5-project-intelligence.md) to avoid adding any new dependency to an
 * otherwise zero-external-service app. "Incremental" here means mtime/size comparison on each call,
 * not push-based file watching — no file watcher exists anywhere in this codebase, and this
 * project's own working directory (like many users' will be) can live on OneDrive/cloud-synced
 * storage, where native watching is known to be unreliable.
 *
 * Persisted at <root>/.coding-agent/index/index.json, written via a temp file + atomic rename so a
 * killed process or a sync client grabbing the file mid-write can't corrupt it. Never throws on
 * load — a missing/corrupt file just means an empty index and a fresh walk, the same convention
 * projectMemory.ts and tools/skills.ts already use.
 */
import { glob } from "glob";
import * as fs from "fs";
import * as path from "path";
import { DEFAULT_IGNORE } from "./tools/search";
import { getRecentActivity } from "./gitHistory";

export interface SymbolEntry {
  name: string;
  kind: string;
  file: string;
  line: number;
}

interface PerFileEntry {
  mtimeMs: number;
  size: number;
  symbols: SymbolEntry[];
  /**
   * Just the distinct token strings this file contributed (no counts — counts live only in the
   * aggregate invertedIndex below, so they're not duplicated on disk). This is what makes removing
   * a changed/deleted file's contribution O(tokens in that one file) instead of O(entire
   * project vocabulary) — without it, "changed" files would require scanning every token in the
   * whole index to find which postings mention this file.
   */
  tokenSet: string[];
}

interface PersistedIndex {
  schemaVersion: 1;
  perFile: Record<string, PerFileEntry>;
  invertedIndex: Record<string, Record<string, number>>; // token -> relPath -> term frequency
}

interface IndexState {
  data: PersistedIndex;
  /** Running total of [token][file] entries across invertedIndex — kept incrementally so checking
   *  the cap doesn't require an O(total entries) recount on every file processed. */
  tokenEntryCount: number;
  filesCapped: boolean;
  tokenCapped: boolean;
  lastWalkAt: number;
  inflight: Promise<void> | null;
}

const THROTTLE_MS = 5_000;
const WALK_TIME_BUDGET_MS = 2_000;
const TOTAL_FILE_CAP = 20_000;
const TOKEN_INDEX_CAP = 300_000;
const MAX_FILE_SIZE = 512 * 1024;
const MAX_SYMBOLS_PER_FILE = 300;
const TOKEN_MIN_LEN = 2;
const DEFAULT_SEARCH_LIMIT = 15;
const DEFAULT_SYMBOL_LIMIT = 50;
const DEFAULT_SYMBOL_MAP_FILE_LIMIT = 150;

const states = new Map<string, IndexState>();

function realpathKey(root: string): string {
  try {
    return fs.realpathSync.native(root);
  } catch {
    return path.resolve(root);
  }
}

function indexDir(root: string): string {
  return path.join(root, ".coding-agent", "index");
}

function indexPath(root: string): string {
  return path.join(indexDir(root), "index.json");
}

function emptyIndex(): PersistedIndex {
  return { schemaVersion: 1, perFile: {}, invertedIndex: {} };
}

function loadPersisted(root: string): PersistedIndex {
  try {
    const raw = fs.readFileSync(indexPath(root), "utf-8");
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      parsed.schemaVersion === 1 &&
      typeof parsed.perFile === "object" &&
      typeof parsed.invertedIndex === "object"
    ) {
      return parsed;
    }
  } catch {
    // missing or corrupt — fall through to an empty index, same "never throws" convention used
    // throughout this codebase (projectMemory.ts, tools/skills.ts).
  }
  return emptyIndex();
}

/** Best-effort — a write failure just means the next process rebuilds from scratch. */
function savePersisted(root: string, data: PersistedIndex): void {
  try {
    const dir = indexDir(root);
    fs.mkdirSync(dir, { recursive: true });
    // Defensive: session.ts normally writes this on first session save, but the index can be built
    // before any session exists yet (e.g. the very first tool call of the very first session).
    const gitignorePath = path.join(root, ".coding-agent", ".gitignore");
    if (!fs.existsSync(gitignorePath)) fs.writeFileSync(gitignorePath, "*\n", "utf-8");

    const finalPath = indexPath(root);
    const tmpPath = `${finalPath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(data), "utf-8");
    fs.renameSync(tmpPath, finalPath); // atomic on both Windows and POSIX for a same-volume rename
  } catch {
    // best-effort
  }
}

function countTokenEntries(data: PersistedIndex): number {
  let n = 0;
  for (const token in data.invertedIndex) n += Object.keys(data.invertedIndex[token]).length;
  return n;
}

function getOrLoadState(root: string): IndexState {
  const key = realpathKey(root);
  let state = states.get(key);
  if (!state) {
    const data = loadPersisted(root);
    state = {
      data,
      tokenEntryCount: countTokenEntries(data),
      filesCapped: false,
      tokenCapped: false,
      lastWalkAt: 0,
      inflight: null,
    };
    states.set(key, state);
  }
  return state;
}

function addFileContribution(
  state: IndexState,
  relPath: string,
  mtimeMs: number,
  size: number,
  symbols: SymbolEntry[],
  tokenCounts: Map<string, number>
): void {
  const { data } = state;
  const tokenSet: string[] = [];
  for (const [token, count] of tokenCounts) {
    tokenSet.push(token);
    let postings = data.invertedIndex[token];
    if (!postings) {
      postings = {};
      data.invertedIndex[token] = postings;
    }
    if (!(relPath in postings)) state.tokenEntryCount++;
    postings[relPath] = count;
  }
  data.perFile[relPath] = { mtimeMs, size, symbols, tokenSet };
}

function removeFileContribution(state: IndexState, relPath: string): void {
  const { data } = state;
  const entry = data.perFile[relPath];
  if (!entry) return;
  for (const token of entry.tokenSet) {
    const postings = data.invertedIndex[token];
    if (!postings) continue;
    if (relPath in postings) {
      delete postings[relPath];
      state.tokenEntryCount--;
    }
    if (Object.keys(postings).length === 0) delete data.invertedIndex[token];
  }
  delete data.perFile[relPath];
}

/** True for real binary content (a NUL byte with no recognized text BOM) OR a UTF-16-BOM'd file —
 *  both get skipped identically: we only ever decode content as UTF-8, so a UTF-16 file would just
 *  tokenize into garbage rather than being usefully searchable. Either way the file is still
 *  recorded in perFile with empty symbols/tokens, so it isn't re-read on every subsequent walk. */
function shouldSkipTokenizing(buf: Buffer): boolean {
  const sample = buf.length > 8192 ? buf.subarray(0, 8192) : buf;
  if (sample.length >= 2 && ((sample[0] === 0xff && sample[1] === 0xfe) || (sample[0] === 0xfe && sample[1] === 0xff))) {
    return true; // UTF-16 LE/BE BOM
  }
  return sample.includes(0);
}

interface SymbolRule {
  kind: string;
  regex: RegExp;
}

// Heuristic, line-by-line, regex-based extraction — not real AST parsing (an explicit scope
// decision, see the module doc comment). Will miss unusual syntax and doesn't understand scoping
// (a nested function isn't distinguished from a top-level one of the same name); good enough for
// "jump to roughly the right place," not a substitute for a real language server.
const SYMBOL_RULES_BY_EXT: Record<string, SymbolRule[]> = {
  ".ts": tsRules(),
  ".tsx": tsRules(),
  ".js": tsRules(),
  ".jsx": tsRules(),
  ".mjs": tsRules(),
  ".cjs": tsRules(),
  ".py": [
    { kind: "function", regex: /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/ },
    { kind: "class", regex: /^\s*class\s+([A-Za-z_]\w*)/ },
  ],
  ".go": [
    { kind: "function", regex: /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/ },
    { kind: "type", regex: /^type\s+([A-Za-z_]\w*)\s+(?:struct|interface)\b/ },
  ],
  ".rs": [
    { kind: "function", regex: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/ },
    { kind: "struct", regex: /^\s*(?:pub(?:\([^)]*\))?\s+)?struct\s+([A-Za-z_]\w*)/ },
    { kind: "enum", regex: /^\s*(?:pub(?:\([^)]*\))?\s+)?enum\s+([A-Za-z_]\w*)/ },
    { kind: "impl", regex: /^\s*impl(?:<[^>]*>)?\s+(?:[A-Za-z_][\w:]*\s+for\s+)?([A-Za-z_]\w*)/ },
  ],
  ".java": javaLikeRules(),
  ".cs": javaLikeRules(),
};

function tsRules(): SymbolRule[] {
  return [
    { kind: "function", regex: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s+([A-Za-z_$][\w$]*)/ },
    { kind: "class", regex: /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/ },
    { kind: "interface", regex: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/ },
    { kind: "type", regex: /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/ },
    { kind: "const", regex: /^\s*export\s+(?:const|let)\s+([A-Za-z_$][\w$]*)/ },
  ];
}

function javaLikeRules(): SymbolRule[] {
  return [
    {
      kind: "type",
      regex: /^\s*(?:public|private|protected|internal)?\s*(?:static\s+)?(?:abstract\s+)?(?:sealed\s+)?(?:class|interface|enum)\s+([A-Za-z_]\w*)/,
    },
  ];
}

function extractSymbols(relPath: string, content: string): SymbolEntry[] {
  const ext = path.extname(relPath).toLowerCase();
  const rules = SYMBOL_RULES_BY_EXT[ext];
  if (!rules || !rules.length) return [];

  const symbols: SymbolEntry[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length && symbols.length < MAX_SYMBOLS_PER_FILE; i++) {
    const line = lines[i];
    for (const rule of rules) {
      const m = rule.regex.exec(line);
      if (m && m[1]) {
        symbols.push({ name: m[1], kind: rule.kind, file: relPath, line: i + 1 });
        break; // at most one symbol per line — keeps this simple and avoids double-counting
      }
    }
  }
  return symbols;
}

function tokenize(content: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const raw of content.split(/[^A-Za-z0-9_]+/)) {
    if (raw.length < TOKEN_MIN_LEN) continue;
    const token = raw.toLowerCase();
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}

async function performWalk(root: string, state: IndexState): Promise<void> {
  // posix: true forces forward-slash paths even on Windows — without it, glob@10 returns
  // backslash-separated paths there for nested files (confirmed empirically), which would make
  // every persisted key inconsistent with itself across a Windows/POSIX-checked-out project and
  // with this same module's own path.basename()/startsWith("/") logic below.
  let matches: string[];
  try {
    matches = await glob("**/*", { cwd: root, ignore: DEFAULT_IGNORE, nodir: true, dot: false, posix: true });
  } catch {
    return; // glob itself failed — keep whatever index we already have rather than wiping it
  }

  const { data } = state;
  const currentSet = new Set(matches);

  for (const relPath of Object.keys(data.perFile)) {
    if (!currentSet.has(relPath)) removeFileContribution(state, relPath);
  }

  state.filesCapped = false;
  state.tokenCapped = false;
  const deadline = Date.now() + WALK_TIME_BUDGET_MS;

  for (const relPath of matches) {
    if (Date.now() > deadline) break; // remaining files get picked up on a later throttle-eligible call

    let st: fs.Stats;
    try {
      st = fs.lstatSync(path.join(root, relPath));
    } catch {
      continue; // vanished mid-walk
    }
    // Symlinks are never indexed, full stop — every other tool routes through resolveInRoot's
    // realpath check specifically to stop a symlink from pointing outside the sandboxed root; a
    // glob walk that read whatever it enumerates would quietly make an out-of-root file's content
    // searchable via search_code.
    if (st.isSymbolicLink() || !st.isFile()) continue;

    const existing = data.perFile[relPath];
    if (existing && existing.mtimeMs === st.mtimeMs && existing.size === st.size) continue; // unchanged

    const isNew = !existing;
    if (isNew && Object.keys(data.perFile).length >= TOTAL_FILE_CAP) {
      state.filesCapped = true;
      continue;
    }

    try {
      if (existing) removeFileContribution(state, relPath);

      if (st.size > MAX_FILE_SIZE) {
        // Never even reads the file — the size check gates readFileSync itself. This matters beyond
        // just CPU cost: a OneDrive/cloud-synced placeholder file triggers a synchronous hydration
        // (download) on first read, which this avoids entirely for anything over the cap.
        addFileContribution(state, relPath, st.mtimeMs, st.size, [], new Map());
        continue;
      }

      const buf = fs.readFileSync(path.join(root, relPath));
      if (shouldSkipTokenizing(buf)) {
        addFileContribution(state, relPath, st.mtimeMs, st.size, [], new Map());
        continue;
      }

      const content = buf.toString("utf-8");
      const symbols = extractSymbols(relPath, content);
      let tokenCounts: Map<string, number>;
      if (state.tokenEntryCount >= TOKEN_INDEX_CAP) {
        tokenCounts = new Map();
        state.tokenCapped = true;
      } else {
        tokenCounts = tokenize(content);
      }
      addFileContribution(state, relPath, st.mtimeMs, st.size, symbols, tokenCounts);
    } catch {
      // one bad file must not abort the whole batch
    }
  }

  savePersisted(root, data);
}

/**
 * Ensures the index for `root` is reasonably fresh before a query — idempotent, throttled (at most
 * one real walk per 5s per root) and de-duplicated (concurrent calls for the same root share one
 * in-flight walk rather than racing two). Never throws.
 */
export function ensureIndex(root: string): Promise<void> {
  const state = getOrLoadState(root);
  if (state.inflight) return state.inflight;
  if (Date.now() - state.lastWalkAt < THROTTLE_MS) return Promise.resolve();

  const walk = performWalk(root, state).finally(() => {
    state.inflight = null;
    state.lastWalkAt = Date.now();
  });
  state.inflight = walk;
  return walk;
}

function normalizePrefix(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "").replace(/\/+$/, "");
}

function grabSnippet(root: string, relFile: string, queryTokens: string[]): string {
  try {
    const content = fs.readFileSync(path.join(root, relFile), "utf-8");
    const lines = content.split("\n");
    for (const line of lines) {
      const lower = line.toLowerCase();
      if (queryTokens.some((t) => lower.includes(t))) return line.trim().slice(0, 200);
    }
    const firstNonEmpty = lines.find((l) => l.trim().length > 0);
    return firstNonEmpty ? firstNonEmpty.trim().slice(0, 200) : "";
  } catch {
    return "";
  }
}

export interface SearchCodeResult {
  results: { file: string; score: number; snippet: string }[];
  capped?: boolean;
}

/**
 * Ranked lexical (keyword) search — not semantic search (see module doc comment for why). Scores
 * each candidate file as sum-over-query-tokens of IDF(token) * (1 + log(termFrequency)); the log
 * dampening on term frequency (rather than raw counts) stops one large file that happens to repeat
 * a token many times from outranking a small, precisely-matching file purely on size. Small bonuses
 * for a query token matching a symbol name or the filename itself, plus a graded recency bonus from
 * the git-history signal.
 */
export function searchCode(root: string, query: string, opts?: { path?: string; limit?: number }): SearchCodeResult {
  const state = getOrLoadState(root);
  const { data } = state;

  const queryTokens = [...tokenize(query).keys()];
  if (!queryTokens.length) return { results: [] };

  const totalFiles = Math.max(1, Object.keys(data.perFile).length);
  const recentFiles = getRecentActivity(root)?.files ?? [];
  const recentRank = new Map<string, number>();
  recentFiles.forEach((f, i) => recentRank.set(f, i));

  const scores = new Map<string, number>();
  for (const token of queryTokens) {
    const postings = data.invertedIndex[token];
    if (!postings) continue;
    const df = Object.keys(postings).length;
    const idf = Math.log(1 + totalFiles / df);
    for (const [file, tf] of Object.entries(postings)) {
      scores.set(file, (scores.get(file) ?? 0) + idf * (1 + Math.log(tf)));
    }
  }

  const capped = state.filesCapped || state.tokenCapped || undefined;
  if (!scores.size) return { results: [], capped };

  // Filtering, not filesystem access — these candidates already came from our own root-confined
  // glob walk, so a resolveInRoot-style realpath check isn't needed here; this just normalizes the
  // caller-supplied prefix into the same relative-posix form our keys use.
  const pathFilter = opts?.path ? normalizePrefix(opts.path) : null;

  const limit = opts?.limit && opts.limit > 0 ? opts.limit : DEFAULT_SEARCH_LIMIT;
  const scored = [...scores.entries()]
    .filter(([file]) => !pathFilter || file === pathFilter || file.startsWith(pathFilter + "/"))
    .map(([file, base]) => {
      let bonus = 0;
      const entry = data.perFile[file];
      if (entry) {
        const baseName = path.basename(file).toLowerCase();
        for (const token of queryTokens) {
          if (entry.symbols.some((s) => s.name.toLowerCase() === token)) bonus += 1.5;
          if (baseName.includes(token)) bonus += 1;
        }
      }
      const rank = recentRank.get(file);
      if (rank !== undefined) bonus += 0.5 * (1 - rank / Math.max(1, recentFiles.length));
      return { file, score: base + bonus };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const results = scored.map(({ file, score }) => ({
    file,
    score: Math.round(score * 100) / 100,
    snippet: grabSnippet(root, file, queryTokens),
  }));
  return { results, capped };
}

export interface FindSymbolResult {
  matches: SymbolEntry[];
  capped?: boolean;
}

/** Exact (case-insensitive) matches rank before substring matches; substring matching is skipped
 *  entirely when opts.exact is set. */
export function findSymbol(root: string, name: string, opts?: { exact?: boolean; limit?: number }): FindSymbolResult {
  const state = getOrLoadState(root);
  const needle = name.trim().toLowerCase();
  if (!needle) return { matches: [] };

  const limit = opts?.limit && opts.limit > 0 ? opts.limit : DEFAULT_SYMBOL_LIMIT;
  const exact: SymbolEntry[] = [];
  const substring: SymbolEntry[] = [];

  for (const entry of Object.values(state.data.perFile)) {
    for (const sym of entry.symbols) {
      const lower = sym.name.toLowerCase();
      if (lower === needle) exact.push(sym);
      else if (!opts?.exact && lower.includes(needle)) substring.push(sym);
    }
  }

  return {
    matches: [...exact, ...substring].slice(0, limit),
    capped: state.filesCapped || state.tokenCapped || undefined,
  };
}

export interface SymbolMapFile {
  file: string;
  symbols: SymbolEntry[];
}

export interface SymbolMapResult {
  files: SymbolMapFile[];
  capped?: boolean;
}

/**
 * A whole-project map of the symbols extractSymbols already found — grouped by file rather than
 * find_symbol's flat match list, since the point here is letting the model see repo structure at a
 * glance (get_symbol_map) instead of looking up one name. Reuses the exact same per-file symbol
 * data findSymbol/searchCode already read; no new extraction, no new dependency. `capped` covers
 * both the underlying index's own caps (filesCapped/tokenCapped) AND this call truncating the file
 * list to `limit` — either way, a whole monorepo shouldn't blow the model's context on one call, so
 * the caller is told when it's seeing a partial view rather than assuming completeness.
 */
export function getSymbolMap(root: string, opts?: { path?: string; limit?: number }): SymbolMapResult {
  const state = getOrLoadState(root);
  const pathFilter = opts?.path ? normalizePrefix(opts.path) : null;
  const limit = opts?.limit && opts.limit > 0 ? opts.limit : DEFAULT_SYMBOL_MAP_FILE_LIMIT;

  const withSymbols = Object.entries(state.data.perFile)
    .filter(([file, entry]) => entry.symbols.length > 0 && (!pathFilter || file === pathFilter || file.startsWith(pathFilter + "/")))
    .sort(([a], [b]) => a.localeCompare(b));

  const files = withSymbols.slice(0, limit).map(([file, entry]) => ({ file, symbols: entry.symbols }));
  const capped = state.filesCapped || state.tokenCapped || withSymbols.length > limit || undefined;

  return { files, capped };
}

/** Test-only seam — clears all in-memory index state so a test can force a cold reload from disk. */
export function _resetCodeIndexCacheForTesting(): void {
  states.clear();
}
