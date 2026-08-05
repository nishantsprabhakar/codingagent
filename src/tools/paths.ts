/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
import * as path from "path";

/**
 * Resolves a user/model-supplied relative path against the sandbox root and
 * rejects anything that escapes it, so the agent can't be tricked into
 * touching files outside the folder it was scoped to.
 */
export function resolveInRoot(root: string, target: string): string {
  const resolved = path.isAbsolute(target)
    ? path.normalize(target)
    : path.normalize(path.join(root, target));

  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(
      `Path "${target}" resolves outside the working directory (${root}). Refusing to access it.`
    );
  }
  return resolved;
}
