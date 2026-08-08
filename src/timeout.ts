/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */

/** The provider clients don't enforce their own request timeout, so a stuck call would otherwise hang forever. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/**
 * Like withTimeout, but for streaming calls: the deadline resets every time
 * `heartbeat()` is called (wrap the stream's onChunk callback with it), so a
 * response that's still actively producing tokens is never cut off — only a
 * connection that's gone completely silent for `idleMs` is.
 */
export function withIdleTimeout<T>(
  run: (heartbeat: () => void) => Promise<T>,
  idleMs: number,
  label: string
): Promise<T> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    let settled = false;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error(`${label} went silent for ${idleMs}ms`));
        }
      }, idleMs);
    };
    arm();
    run(arm).then(
      (v) => {
        settled = true;
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}
