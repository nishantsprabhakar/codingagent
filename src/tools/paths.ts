/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
import * as fs from "fs";
import * as path from "path";

/**
 * Resolves `dir` to its real, symlink-free path, walking up to the nearest
 * existing ancestor if `dir` itself doesn't exist yet (e.g. a new nested
 * directory a write is about to create). Never throws for a nonexistent
 * path — returns the best real prefix it could find plus the remaining
 * (not-yet-existing) segments re-joined lexically, which is exactly what a
 * caller needs to confine a not-yet-created file.
 */
function realpathWithNonexistentTail(dir: string): string {
  const segments: string[] = [];
  let current = dir;
  while (true) {
    try {
      const real = fs.realpathSync(current);
      return segments.length ? path.join(real, ...segments.reverse()) : real;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.join(...segments.reverse());
      segments.push(path.basename(current));
      current = parent;
    }
  }
}

/**
 * Resolves a user/model-supplied relative path against the sandbox root and
 * rejects anything that escapes it — including escapes hidden behind a
 * symlink or (on Windows) a junction inside the root that points outside it.
 * Lexical checks alone (path.normalize + startsWith) are exactly what a
 * symlink defeats: the *string* still starts with the root while the real
 * file it points to does not, so every resolution here goes through
 * fs.realpathSync on both sides before the containment check.
 *
 * Handles the write case (the leaf file, and possibly several nested parent
 * directories, don't exist yet) by realpath-resolving only the nearest
 * existing ancestor and re-appending the remaining path lexically — an
 * attacker can't plant a symlink at a path that doesn't exist, so this loses
 * no protection while still allowing `create_docx("new/nested/report.docx")`
 * to work the first time.
 */
export function resolveInRoot(root: string, target: string): string {
  const lexicallyResolved = path.isAbsolute(target)
    ? path.normalize(target)
    : path.normalize(path.join(root, target));

  const relativeLexical = path.relative(root, lexicallyResolved);
  if (relativeLexical.startsWith("..") || path.isAbsolute(relativeLexical)) {
    throw new Error(
      `Path "${target}" resolves outside the working directory (${root}). Refusing to access it.`
    );
  }

  let realRoot: string;
  try {
    realRoot = fs.realpathSync(root);
  } catch {
    // Root itself doesn't exist (caller error, not an attack surface) — fall back to the lexical result.
    return lexicallyResolved;
  }

  const realTarget = realpathWithNonexistentTail(lexicallyResolved);
  const relativeReal = path.relative(realRoot, realTarget);
  if (relativeReal.startsWith("..") || path.isAbsolute(relativeReal)) {
    throw new Error(
      `Path "${target}" resolves outside the working directory (${root}) once symlinks are followed. Refusing to access it.`
    );
  }

  // Return the lexical form (not the realpath) so callers keep operating on
  // the path the way the rest of the codebase already expects — the
  // realpath detour above is purely a containment check, not a rewrite.
  return lexicallyResolved;
}
