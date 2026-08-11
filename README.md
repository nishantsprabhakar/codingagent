# Wrexlyn

&copy; 2026 Nishant Prabhakar. All rights reserved. See [LICENSE](LICENSE).

A minimal coding agent — it takes a
natural-language prompt, decides which tools to call, and edits files or runs
commands in a working directory with your permission. It uses a pluggable
model backend: [Pollinations AI](https://pollinations.ai) is free and keyless
but, as of 2026-07-30, no longer supports the tool-calling this agent depends
on — so in practice you need a free key from [Groq](https://console.groq.com/keys)
or [OpenRouter](https://openrouter.ai/keys) instead (both still $0 for typical
use). Comes with both a terminal REPL and a web UI.

## Quick start (no terminal required)

1. Install [Node.js](https://nodejs.org) if you don't already have it (just
   click through the installer — no terminal needed for that either).
2. Double-click **`Coding Agent`** on your Desktop (or **`Start Coding
   Agent.bat`** inside this folder).
3. The first time, a folder picker will pop up — choose the project you want
   the agent to work on.
4. Next, you'll be asked for a free API key from Groq or OpenRouter (paste
   either — the launcher detects which one from its format). Get one in under
   a minute: [console.groq.com/keys](https://console.groq.com/keys) or
   [openrouter.ai/keys](https://openrouter.ai/keys), no credit card needed.
   You can skip this, but the agent won't be able to take real actions until
   you add one (see Known limitations below).
5. A browser window opens automatically at `http://localhost:4390` with the
   chat UI.
6. To close it later, just close the console window that opened alongside the
   browser tab.
7. To point it at a different project later, double-click **`Change Project
   Folder.bat`**. To add or change your key later, double-click **`Change
   Model Key.bat`**.

Everything else in this README (npm scripts, CLI flags, the terminal REPL) is
for anyone who wants to run it manually or dig into how it works.

## Installers

**Windows** — stamp the version, then build with Inno Setup:

```
node scripts\write-version.js
"C:\Users\<you>\AppData\Local\Programs\Inno Setup 6\ISCC.exe" installer\windows\wrexlyn.iss
```

This produces `installer/windows/output/Wrexlyn-Setup.exe` — running it installs
to `%LOCALAPPDATA%\Programs\Wrexlyn`, adds Desktop + Start Menu shortcuts for
Coding Agent / Change Model Key / Change Project Folder, and registers a
proper uninstaller. First launch still does the same one-time `npm install` /
`npm run build` / folder-and-key setup described above.

**Linux** — run the installer script from inside this project folder:

```bash
./install.sh
```

This copies the project to `~/.local/share/wrexlyn`, adds a `wrexlyn` command
to `~/.local/bin`, and registers a desktop launcher entry. First launch (via
`wrexlyn`, the desktop entry, or `Start Coding Agent.sh` directly) does the
same first-time setup — installs dependencies, builds, then prompts in the
terminal for a project folder and optional API key (equivalent to the Windows
folder-picker/key dialogs, just via stdin instead of native dialogs). Use
`Change Model Key.sh` / `Change Project Folder.sh` to update those later —
both exist as standalone scripts too, for running directly without a full
install.

**Update checks**: every launch (both platforms) checks GitHub for a newer
commit on `main` — a fast, best-effort check with a 5s timeout that never
blocks startup (offline just means it's skipped silently). Behavior depends
on how you're running it:
- **Git checkout** (cloned the repo directly): if behind, prompts
  `Update now? [y/N]` — accepting runs `git pull --ff-only` + `npm install` +
  `npm run build` before continuing. A non-fast-forward pull (e.g. local
  commits) fails safely and just continues on the current version.
- **Installed via Setup.exe/install.sh**: reports that an update exists and
  links to the repo, but doesn't apply it automatically — replacing an
  installed copy's files while it's the thing currently running is a real
  footgun (locked files, no rollback), so this stays a manual re-download for
  now.

## Requirements

- Node.js 18+ (for global `fetch` and modern JS support). Install from
  [nodejs.org](https://nodejs.org) if `node -v` doesn't work in your terminal.

## Setup

```bash
cd coding-agent
npm install
npm run build
npm start -- --cwd /path/to/your/project
```

Or run without building, for development:

```bash
npm install
npm run dev -- --cwd /path/to/your/project
```

To install it as a global `agent` command:

```bash
npm install -g .
agent --cwd /path/to/your/project
```

## Usage

```
agent [options]

Options:
  --cwd <path>      Working directory the agent may read/write (default: current directory)
  --provider <name> "pollinations" (default, free, no key), "groq", or "openrouter" (both free tier, need a key)
  --model <name>    Model to use (default: "openai" for pollinations, "llama-3.3-70b-versatile" for groq,
                    "openai/gpt-oss-20b:free" for openrouter)
  --api-key <key>   API key for --provider groq/openrouter (or set GROQ_API_KEY / OPENROUTER_API_KEY)
  --yolo            Auto-approve all file writes / edits / shell commands (dangerous)
  --web             Serve the web UI instead of the terminal REPL
  --port <n>        Port for the web UI (default: 4390)
  --help            Show this help
```

### Using Groq or OpenRouter instead of Pollinations

**As of 2026-07-30, Pollinations requires a paid account for tool-calling
requests** — which is everything this agent does (reading files, writing
code, running commands). Anonymous Pollinations access is effectively
unusable for this agent now; you need a key from one of these instead:

- [Groq](https://console.groq.com/keys) — free tier, no credit card,
  `llama-3.3-70b-versatile` by default (or `openai/gpt-oss-120b` via `--model`).
- [OpenRouter](https://openrouter.ai/keys) — free tier, `inclusionai/ling-3.0-flash:free`
  by default. OpenRouter's free-model lineup rotates over time; browse current
  ones at [openrouter.ai/models?max_price=0](https://openrouter.ai/models?max_price=0)
  and pass a different one with `--model` if needed — verify it actually
  supports tool calling before relying on it (not all free models do).

```bash
agent --web --provider groq --api-key gsk_your_key_here --cwd /path/to/your/project
agent --web --provider openrouter --api-key sk-or-v1-your_key_here --cwd /path/to/your/project
# or set one once for the session:
export GROQ_API_KEY=gsk_your_key_here
agent --web --provider groq --cwd /path/to/your/project
```

The double-click launcher asks for a key once (either provider — it's
auto-detected from the key's format, `sk-or-v1-...` vs anything else) and
remembers your choice; skip it and it'll ask again next launch. Update it
anytime via `Change Model Key.bat`.

### Web UI

```bash
npm run web -- --cwd /path/to/your/project
# or, after building:
npm start -- --web --cwd /path/to/your/project
```

Then open `http://localhost:4390`. It gives you a chat panel, a file tree you
can click through to preview files, tool-call cards you can expand to see
output, and a permission modal (with a diff preview) for every mutating
action — same permission model as the terminal, just with buttons instead of
keystrokes.

### Terminal REPL

Once running, just type what you want:

```
you> add a .gitignore for a Node project and initialize git
you> read package.json and add a "lint" script that runs eslint
you> there's a bug in src/utils.ts where dates aren't parsed correctly, find and fix it
```

REPL commands:

- `/new` (or `/reset`) — start a new chat (keeps the same working directory)
- `/sessions` — list this project's chats (`*` marks the active one)
- `/switch <id>` — switch to a chat by id (from `/sessions`)
- `/cwd <path>` — switch working directory
- `/exit` — quit

## How it works

- **Model**: pluggable provider (`src/providers/`) — Pollinations (default,
  keyless, but no longer usable for tool-calling — see Known limitations),
  Groq, or OpenRouter, all OpenAI-compatible chat completions endpoints. Each
  provider retries on 429/5xx and fails fast (no pointless retrying) on
  permanent errors like 401/402/404.
- **Tools**: `read_file`, `write_file`, `edit_file`, `list_dir`, `glob_search`,
  `grep_search`, `run_shell_command`, `create_docx`, `create_pptx`,
  `create_xlsx`, `web_fetch`, `read_pdf`, `redline_docx`, `recall_skill` —
  file paths are sandboxed to the `--cwd` root (a path that resolves outside
  it is rejected). `update_tasks`, `remember_preference`, and `save_skill`
  are handled specially (they update session/project state directly rather
  than just touching the filesystem).
- **Permissions**: read-only tools (including `web_fetch`) run automatically.
  Mutating tools (file writes, shell commands, MCP tool calls) print a preview
  (diff for edits, full content for new files, the literal command for shell)
  and ask `[y]es / [a]lways / [n]o` before running, unless `--yolo` is passed.
- **Streaming**: responses stream token-by-token (both the terminal and web
  UI), including any reasoning the model narrates before calling a tool — not
  just the final answer.
- **Loop**: on each user message, the agent calls the model, executes any
  requested tool calls (independent read-only calls run concurrently), feeds
  the results back, and repeats until the model responds with plain text
  instead of a tool call.

## Features

- **Project context**: on startup, the agent automatically reads your
  project's top-level file listing, `package.json` (name/description/scripts/
  dependencies), and README, and gives that to the model up front — it
  doesn't need to `list_dir` just to find out what kind of project this is.
- **Documents**: ask for a Word doc, PowerPoint deck, or Excel workbook and
  the agent generates a genuine, well-formatted `.docx`/`.pptx`/`.xlsx` file
  (headings, bullet lists, tables; bold header rows and auto-sized columns in
  Excel) — not just a text file with the wrong extension. PowerPoint defaults
  to a dark theme with an accent-colored icon badge next to each slide title
  (`theme: "light"` to opt out); Word and Excel default to a light-blue
  header band on top-level headings and table/sheet header rows, with the
  Excel sheet tab colored to match. A custom `accentColor` on any of the
  three derives a matching tint instead of the hardcoded default blue.
- **Document quality gate**: before writing a `.docx`/`.pptx`/`.xlsx` file,
  the tool runs a deterministic (non-LLM) structural check — leftover
  placeholder text ("TODO", "lorem ipsum", etc.), a table whose rows don't
  match its header count, or a table/sheet with headers but no data all fail
  the call closed with a specific reason, so the model corrects it before
  anything is written. This is what's model-agnostic about output quality
  here: it inspects the actual generated content, not the model's confidence
  about it. A document-only turn that passes cleanly gets a genuine
  "verified" confidence score in the end-of-turn transaction summary instead
  of the default "changes made, unverified".
- **Self-learning**: the agent has two tools for carrying things forward
  beyond one turn. `remember_preference` persists a standing preference the
  user states about formatting/tone/workflow (project-scoped, or global via
  `~/.coding-agent/global-instructions.txt`) and takes effect immediately —
  no restart needed. `save_skill` / `recall_skill` persist a reusable
  multi-step pattern under `.coding-agent/skills/<name>.json`; every saved
  skill's name and one-line description are listed in the system prompt from
  then on, with `recall_skill` fetching the full steps on demand. Repeated
  document quality-check failures of the *same specific kind* are also
  folded into project memory as a short lesson (`ProjectMemory.learnedLessons`)
  so the model stops making that particular mistake in this project — never
  by editing the app's own code, only by steering what the model is told.
- **Progress visualization**: for anything beyond a single trivial step, the
  agent lays out a plan as a task list, shown in the web UI as a percentage
  ring plus a connected step-by-step timeline (pulsing while a step is in
  progress, filling in as steps complete) — and as a plain checklist in the
  terminal. It updates this as it works, the same way it'd track its own
  todos.
- **Multiple chats per project**: the sidebar's "Chats" section works like a
  normal chat app — **+ New** starts a fresh conversation, past chats are
  listed with an auto-generated title and last-updated time, click one to
  switch back to it (full history and progress state included), hover for a
  delete button. Each is stored separately under
  `.coding-agent/sessions/<id>.json`; closing the tab and reopening resumes
  whichever chat was active. Projects using the older single-session format
  are migrated automatically the first time they're opened.
- **MCP support / app connectors**: drop an `mcp.json` in your project root
  (see `mcp.json.example` — the standard MCP config shape most editors and AI
  tool clients use: `{"mcpServers": {"name": {"command", "args", "env"}}}`)
  and the agent
  connects to those servers on startup, merging their tools in as
  `mcp__<server>__<tool>`, gated behind the same permission prompts as
  everything else. A server that fails to start is skipped with a logged
  warning, not fatal. The settings modal (gear icon) has an "MCP Servers" tab
  to add/edit/remove servers without hand-editing JSON — saving reconnects
  live, no restart needed.
- **Global instructions**: the settings modal's "Global Instructions" tab
  holds free-text instructions applied to every project on this machine —
  stored once at `~/.coding-agent/global-instructions.txt`, applied to the
  system prompt immediately on save.
- **Switch project folder / create a new project**: the folder icon in the
  web UI's header opens a modal with an in-app folder browser (drives on
  Windows, home directory on Linux/macOS — click a folder to descend, the up
  arrow to go back), a "new folder" field to create and switch into a fresh
  project directory in one step, plus your last 10 folders for one-click
  switching back.
- **File upload**: the paperclip icon next to the composer (or dragging a file
  onto the chat) uploads it straight into the project root, so you can hand
  the agent a reference file without it already being in the folder.
- **Model picker**: click the model badge in the header to search and switch
  models without losing your conversation. For OpenRouter this fetches the
  live list of 300+ models and filters it down to ones that actually support
  tool-calling (most don't) — free ones are tagged and sorted first. Groq's
  small, stable lineup is listed directly. Your choice is remembered per
  provider (`~/.coding-agent/preferences.json`) and reused on the next
  launch.
- **Phone access**: Settings → "Connect from Phone" shows a QR code and the
  URL for reaching this machine from any device on the same Wi-Fi (the server
  already listens on all interfaces, not just localhost) — scan it from an
  iPhone, then Share → Add to Home Screen for a standalone, app-like icon. The
  UI is responsive down to phone widths, and iOS-specific quirks (input
  auto-zoom, dynamic viewport height, Dynamic Island/home-indicator overlap in
  standalone mode) are handled. If it doesn't load, check Windows Firewall
  hasn't blocked Node.js on private networks.

## Known limitations

- **Pollinations (the default, keyless provider) can no longer run this agent
  at all**, as of 2026-07-30 — it now requires a paid account for tool-calling
  requests specifically, which is everything this agent does. You need a
  `--provider groq` or `--provider openrouter` key (see above); plain chat
  without tools is the only thing that still works anonymously on Pollinations.
- Free-tier model lineups on Groq/OpenRouter shift over time — if a model
  stops working, check current model lists (linked above) and update
  `--model`.
- `run_shell_command` is sandboxed to the working directory via `cwd`, but the
  command itself is not restricted — it can still reference absolute paths.
  The permission prompt is your safety net; review commands before approving.
- MCP support only covers stdio-based servers (spawned as a subprocess) — no HTTP/SSE remote servers yet.
- Session persistence is per-project (one `.coding-agent/session.json`), not per-browser-tab — opening the same
  project from two tabs/terminals at once will race on the same history file.
