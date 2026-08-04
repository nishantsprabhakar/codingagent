# Double-click entry point for coding-agent. No typing required: this script
# installs dependencies on first run, asks (once, via native dialogs) which
# project the agent should work on and whether to use a stronger free model,
# starts the server, and opens the browser automatically. Closing the console
# window stops the agent.

param(
    [switch]$ResetFolder,
    [switch]$ResetApiKey
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Write-Step($text) {
    Write-Host $text -ForegroundColor Cyan
}

function Resolve-Tool($name, $fallbackPath) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    if (Test-Path $fallbackPath) { return $fallbackPath }
    return $null
}

$nodePath = Resolve-Tool "node" "C:\Program Files\nodejs\node.exe"
$npmPath = Resolve-Tool "npm" "C:\Program Files\nodejs\npm.cmd"

if (-not $nodePath -or -not $npmPath) {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show(
        "Node.js is required but wasn't found. Please install it from https://nodejs.org, then double-click this launcher again.",
        "Coding Agent - Node.js missing",
        "OK",
        "Error"
    ) | Out-Null
    exit 1
}

Write-Host ""
Write-Host "===================================" -ForegroundColor DarkCyan
Write-Host "        Coding Agent" -ForegroundColor DarkCyan
Write-Host "===================================" -ForegroundColor DarkCyan
Write-Host ""

if (-not (Test-Path "$root\node_modules")) {
    Write-Step "First-time setup: installing dependencies (this can take a minute)..."
    & $npmPath install
    if ($LASTEXITCODE -ne 0) { Write-Host "Dependency install failed." -ForegroundColor Red; exit 1 }
}

if (-not (Test-Path "$root\dist\index.js")) {
    Write-Step "Building..."
    & $npmPath run build
    if ($LASTEXITCODE -ne 0) { Write-Host "Build failed." -ForegroundColor Red; exit 1 }
}

$configPath = "$root\agent.config.json"
$config = [PSCustomObject]@{ folder = $null; provider = $null; apiKey = $null }
if (Test-Path $configPath) {
    try {
        $loaded = Get-Content $configPath -Raw | ConvertFrom-Json
        if ($loaded.folder) { $config.folder = $loaded.folder }
        if ($null -ne $loaded.apiKey) { $config.apiKey = $loaded.apiKey }
        if ($loaded.provider) { $config.provider = $loaded.provider }
        # Back-compat with the older groqApiKey-only config field.
        if ($null -eq $config.apiKey -and $null -ne $loaded.groqApiKey) {
            $config.apiKey = $loaded.groqApiKey
            $config.provider = if ($loaded.groqApiKey) { "groq" } else { "" }
        }
    } catch {}
}

if ($ResetFolder) { $config.folder = $null }
if ($ResetApiKey) { $config.apiKey = $null; $config.provider = $null }

$folder = $config.folder
if (-not $folder -or -not (Test-Path $folder -PathType Container)) {
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = "Choose the project folder you want the Coding Agent to work on"
    $dialog.ShowNewFolderButton = $true

    Write-Step "Choose which folder the agent should work on..."
    $result = $dialog.ShowDialog()
    if ($result -ne [System.Windows.Forms.DialogResult]::OK) {
        Write-Host "No folder selected. Exiting." -ForegroundColor Red
        exit 1
    }
    $folder = $dialog.SelectedPath
}

# A folder just created via the dialog's "Make New Folder" button can, in rare
# cases (e.g. inside a OneDrive-synced path), not actually exist on disk yet.
# Never persist or launch against a path that isn't real.
if (-not (Test-Path $folder -PathType Container)) {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show(
        "That folder couldn't be found:`n$folder`n`nPlease double-click the launcher again and choose an existing folder.",
        "Coding Agent - folder not found",
        "OK",
        "Error"
    ) | Out-Null
    Remove-Item $configPath -ErrorAction SilentlyContinue
    exit 1
}
$config.folder = $folder

if ($null -eq $config.apiKey) {
    Add-Type -AssemblyName Microsoft.VisualBasic
    $key = [Microsoft.VisualBasic.Interaction]::InputBox(
        "Optional upgrade: the default free model (Pollinations) is small, and as of mid-2026 no longer supports " +
        "the tool-calling this agent depends on for free. Paste a free API key below from either:`n`n" +
        "  - Groq: https://console.groq.com/keys`n" +
        "  - OpenRouter: https://openrouter.ai/keys`n`n" +
        "Leave this blank and click OK to skip (the agent will still run, but won't be able to take real actions " +
        "until you add a key here or via 'Change Model Key.bat').",
        "Coding Agent - model key",
        ""
    )
    $trimmedKey = if ($key) { $key.Trim() } else { "" }
    $config.apiKey = $trimmedKey
    $config.provider = if ($trimmedKey -like "sk-or-v1-*") { "openrouter" } elseif ($trimmedKey) { "groq" } else { "" }
}

$config | ConvertTo-Json | Set-Content $configPath

Write-Host ""
Write-Host "Working directory: $folder" -ForegroundColor DarkGray

$port = 4390
$nodeArgs = @("$root\dist\index.js", "--web", "--cwd", $folder, "--port", $port)
if ($config.apiKey -and $config.provider) {
    $nodeArgs += @("--provider", $config.provider, "--api-key", $config.apiKey)
    Write-Host "Model: $($config.provider) (upgraded)" -ForegroundColor DarkGray
} else {
    Write-Host "Model: Pollinations / openai (default free model - tool-calling may not work, see README)" -ForegroundColor DarkGray
}

Write-Host "Starting server and opening your browser..." -ForegroundColor DarkGray
Write-Host "(Close this window at any time to stop the agent.)" -ForegroundColor DarkGray
Write-Host ""

Start-Process "powershell" -ArgumentList "-NoProfile -WindowStyle Hidden -File `"$root\scripts\open-browser-when-ready.ps1`" -Port $port" -WindowStyle Hidden | Out-Null

& $nodePath @nodeArgs
