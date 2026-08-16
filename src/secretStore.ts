/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * OS-backed secret storage for API keys, with an explicit, documented
 * plaintext fallback when no OS-level mechanism is available.
 *
 * - Windows: values are encrypted with the Windows Data Protection API
 *   (DPAPI, `CurrentUser` scope) via a short PowerShell invocation, then
 *   the ciphertext is stored in a local JSON file. DPAPI ties decryption to
 *   the specific Windows user profile — the ciphertext is useless copied to
 *   another machine or read by another account — which is what "OS-backed"
 *   is actually protecting against for a single-user local tool. This is a
 *   deliberate choice over driving the Credential Manager Win32 API
 *   (CredWrite/CredRead) directly: that would need P/Invoke boilerplate
 *   embedded in a shelled-out script, which is measurably more fragile to
 *   get right across PowerShell versions than a single well-known .NET
 *   type. Secret bytes always travel over the child process's stdin, never
 *   as a command-line argument, so they never appear in a process listing.
 * - macOS: the real login Keychain, via the `security` CLI
 *   (add-generic-password/find-generic-password/delete-generic-password).
 *   Known, disclosed limitation: `security add-generic-password` takes the
 *   secret as a command-line argument (there's no stdin form for writes in
 *   the standard CLI), so it's briefly visible to another local process
 *   inspecting the process list for the instant the command runs — the
 *   same trade-off every tool that shells out to `security` accepts.
 * - Linux: libsecret via the `secret-tool` CLI (GNOME Keyring/KWallet
 *   backends). Writes go over stdin, so no argv exposure here. Requires
 *   `secret-tool` to be installed and a keyring daemon reachable over
 *   D-Bus — genuinely not present on every Linux install (e.g. a headless
 *   server with no session bus), which is exactly why this has a fallback.
 * - Fallback (any platform where the above isn't available): the original
 *   plaintext JSON file this project always used
 *   (`~/.coding-agent/api-keys.json`), so a key already stored there before
 *   this change keeps working with zero migration friction. A clear warning
 *   is logged once per process when this path is taken, and callers can
 *   check `describeActiveBackend()` to surface it in the UI.
 */
import { spawn } from "child_process";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";

export interface SecretStore {
  readonly backendName: string;
  /** True if this backend's OS mechanism is actually usable right now (not just "this OS is theoretically supported"). */
  isAvailable(): Promise<boolean>;
  get(account: string): Promise<string | null>;
  set(account: string, value: string): Promise<void>;
  delete(account: string): Promise<void>;
}

const SERVICE_NAME = "Wrexlyn";
/** Overridable only by tests — production code must never call this. */
let baseDirOverride: string | null = null;
export function _setBaseDirForTesting(dir: string | null): void {
  baseDirOverride = dir;
}
function baseDir(): string {
  return baseDirOverride ?? path.join(os.homedir(), ".coding-agent");
}

function runCommand(command: string, args: string[], stdinInput?: string, timeoutMs = 10_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
      else resolve(stdout);
    });

    if (stdinInput !== undefined) child.stdin.write(stdinInput, "utf-8");
    child.stdin.end();
  });
}

// ---------- Windows: DPAPI-encrypted values in a local JSON file ----------

const DPAPI_ENCRYPT_SCRIPT = `
Add-Type -AssemblyName System.Security
$plaintext = [Console]::In.ReadToEnd()
$bytes = [System.Text.Encoding]::UTF8.GetBytes($plaintext)
$protected = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write([Convert]::ToBase64String($protected))
`;

const DPAPI_DECRYPT_SCRIPT = `
Add-Type -AssemblyName System.Security
$b64 = [Console]::In.ReadToEnd().Trim()
$bytes = [Convert]::FromBase64String($b64)
$decrypted = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write([System.Text.Encoding]::UTF8.GetString($decrypted))
`;

function dpapiStorePath(): string {
  return path.join(baseDir(), "secrets.dpapi.json");
}

function loadDpapiFile(): Record<string, string> {
  try {
    const filePath = dpapiStorePath();
    if (!fs.existsSync(filePath)) return {};
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return {};
  }
}

function saveDpapiFile(data: Record<string, string>): void {
  const filePath = dpapiStorePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

export class WindowsDpapiBackend implements SecretStore {
  readonly backendName = "Windows Data Protection API (DPAPI, current user)";

  async isAvailable(): Promise<boolean> {
    if (process.platform !== "win32") return false;
    try {
      // 15s, not 8s: this spawns a real powershell.exe process, and under genuine system load (heavy
      // CPU contention from something else running, e.g. this project's own 35-file test suite) 8s
      // was tight enough to occasionally time out — which silently downgrades a real user's API keys
      // to the plaintext fallback for the rest of the process's life, not just a test-suite flake.
      const out = await runCommand("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", DPAPI_ENCRYPT_SCRIPT], "probe", 15_000);
      return out.length > 0;
    } catch {
      return false;
    }
  }

  async get(account: string): Promise<string | null> {
    const ciphertext = loadDpapiFile()[account];
    if (!ciphertext) return null;
    try {
      return await runCommand("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", DPAPI_DECRYPT_SCRIPT], ciphertext);
    } catch {
      return null; // corrupt entry or a different user profile than the one that wrote it — treat as absent, not fatal
    }
  }

  async set(account: string, value: string): Promise<void> {
    const ciphertext = await runCommand("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", DPAPI_ENCRYPT_SCRIPT], value);
    const data = loadDpapiFile();
    data[account] = ciphertext;
    saveDpapiFile(data);
  }

  async delete(account: string): Promise<void> {
    const data = loadDpapiFile();
    delete data[account];
    saveDpapiFile(data);
  }
}

// ---------- macOS: the login Keychain via the `security` CLI ----------

export class MacKeychainBackend implements SecretStore {
  readonly backendName = "macOS Keychain";

  async isAvailable(): Promise<boolean> {
    if (process.platform !== "darwin") return false;
    try {
      await runCommand("security", ["list-keychains"], undefined, 5_000);
      return true;
    } catch {
      return false;
    }
  }

  async get(account: string): Promise<string | null> {
    try {
      const out = await runCommand("security", ["find-generic-password", "-a", account, "-s", SERVICE_NAME, "-w"]);
      const value = out.trim();
      return value || null;
    } catch {
      return null; // "item not found" is the expected case for a never-set key — not an error worth surfacing
    }
  }

  async set(account: string, value: string): Promise<void> {
    // -U updates in place if an entry for this account+service already exists, instead of erroring on a duplicate.
    await runCommand("security", ["add-generic-password", "-a", account, "-s", SERVICE_NAME, "-w", value, "-U"]);
  }

  async delete(account: string): Promise<void> {
    try {
      await runCommand("security", ["delete-generic-password", "-a", account, "-s", SERVICE_NAME]);
    } catch {
      // already absent — deleting a nonexistent entry isn't an error condition for this API's callers
    }
  }
}

// ---------- Linux: libsecret via the `secret-tool` CLI ----------

export class LinuxSecretServiceBackend implements SecretStore {
  readonly backendName = "Linux Secret Service (libsecret / secret-tool)";

  async isAvailable(): Promise<boolean> {
    if (process.platform !== "linux") return false;
    try {
      // A real probe, not just "the binary exists" — secret-tool can be installed with no keyring daemon
      // reachable over D-Bus (e.g. a headless server), in which case any real store/lookup call fails.
      await runCommand("secret-tool", ["search", "--all", "wrexlyn-availability-probe", "none"], undefined, 5_000);
      return true;
    } catch {
      return false;
    }
  }

  async get(account: string): Promise<string | null> {
    try {
      const out = await runCommand("secret-tool", ["lookup", "service", SERVICE_NAME, "account", account]);
      const value = out.trim();
      return value || null;
    } catch {
      return null;
    }
  }

  async set(account: string, value: string): Promise<void> {
    await runCommand(
      "secret-tool",
      ["store", "--label", `${SERVICE_NAME} (${account})`, "service", SERVICE_NAME, "account", account],
      value
    );
  }

  async delete(account: string): Promise<void> {
    try {
      await runCommand("secret-tool", ["clear", "service", SERVICE_NAME, "account", account]);
    } catch {
      // already absent
    }
  }
}

// ---------- Fallback: plain JSON, same file/format this project always used ----------

function plaintextStorePath(): string {
  return path.join(baseDir(), "api-keys.json");
}

export class PlaintextFileBackend implements SecretStore {
  readonly backendName = "plaintext local file (no OS secure storage available)";

  async isAvailable(): Promise<boolean> {
    return true; // the fallback of last resort — always "available"
  }

  private load(): Record<string, string> {
    try {
      const filePath = plaintextStorePath();
      if (!fs.existsSync(filePath)) return {};
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch {
      return {};
    }
  }

  private save(data: Record<string, string>): void {
    const filePath = plaintextStorePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  }

  async get(account: string): Promise<string | null> {
    return this.load()[account] ?? null;
  }

  async set(account: string, value: string): Promise<void> {
    const data = this.load();
    data[account] = value;
    this.save(data);
  }

  async delete(account: string): Promise<void> {
    const data = this.load();
    delete data[account];
    this.save(data);
  }
}

// ---------- Backend selection ----------

const BACKEND_CANDIDATES: SecretStore[] = [new WindowsDpapiBackend(), new MacKeychainBackend(), new LinuxSecretServiceBackend()];
const fallbackBackend = new PlaintextFileBackend();

let selected: SecretStore | null = null;
let warnedFallback = false;

/** Probes candidates in order and caches the first available one for the rest of the process's lifetime. */
export async function getSecretStore(): Promise<SecretStore> {
  if (selected) return selected;
  for (const candidate of BACKEND_CANDIDATES) {
    if (await candidate.isAvailable()) {
      selected = candidate;
      return selected;
    }
  }
  if (!warnedFallback) {
    warnedFallback = true;
    console.warn(
      "[coding-agent] No OS-backed secure storage is available on this system — API keys will be stored in a " +
        `plain local file (${plaintextStorePath()}). This is the same storage this project always used before ` +
        "OS-backed storage was added; it is not a new weakness, but it is not encrypted at rest."
    );
  }
  selected = fallbackBackend;
  return selected;
}

/** For the settings UI / startup banner — never call this to decide security-relevant logic, only to display status. */
export async function describeActiveBackend(): Promise<string> {
  return (await getSecretStore()).backendName;
}

/** Test-only: forces re-probing on the next getSecretStore() call instead of reusing the cached backend. */
export function _resetSecretStoreForTesting(): void {
  selected = null;
  warnedFallback = false;
}

/**
 * Test-only: pins the backend directly instead of letting getSecretStore() probe for one. Real backend
 * selection spawns a subprocess (e.g. a PowerShell DPAPI probe on Windows) with its own timeout — under the
 * CPU contention of a full parallel test-suite run, that probe can lose the race and fall back to a different
 * backend than the one being tested, which is a source of flakiness unrelated to the logic under test. Tests
 * that need to assert behavior specific to one backend (e.g. "a secure backend migrates and removes the
 * legacy plaintext key") should pin it here rather than depend on the probe's outcome.
 */
export function _setSelectedBackendForTesting(store: SecretStore | null): void {
  selected = store;
}
