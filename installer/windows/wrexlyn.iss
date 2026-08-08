; Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
; Unauthorized copying, modification, or distribution is prohibited.
; See LICENSE for details.
;
; Builds Wrexlyn-Setup.exe: a per-user (no admin required) Windows installer.
; It ships the app's source + scripts (not node_modules/dist, which the
; existing first-run launcher already generates on the target machine — see
; scripts/launch.ps1), and creates Desktop/Start Menu shortcuts + an
; uninstaller.
;
; Build with: "C:\Users\<you>\AppData\Local\Programs\Inno Setup 6\ISCC.exe" wrexlyn.iss

#define AppName "Wrexlyn"
#define AppVersion "0.1.0"
#define AppPublisher "Nishant Prabhakar"

[Setup]
AppId={{8F2C1E1A-6B9C-4E4F-9C7B-2C6C9E7B6A11}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={localappdata}\Programs\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=output
OutputBaseFilename=Wrexlyn-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\Start Coding Agent.bat
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "..\..\public\*"; DestDir: "{app}\public"; Flags: recursesubdirs ignoreversion
Source: "..\..\src\*"; DestDir: "{app}\src"; Flags: recursesubdirs ignoreversion
Source: "..\..\scripts\*"; DestDir: "{app}\scripts"; Flags: recursesubdirs ignoreversion
Source: "..\..\package.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\package-lock.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\tsconfig.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\README.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\LICENSE"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\mcp.json.example"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\Start Coding Agent.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\Change Model Key.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\Change Project Folder.bat"; DestDir: "{app}"; Flags: ignoreversion
; Stamps the source commit so check-update.js has something to compare against on
; every launch — regenerate this (node scripts/write-version.js) right before
; recompiling, so the installer always ships the commit it was actually built from.
Source: "..\..\version.json"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autodesktop}\Coding Agent"; Filename: "{app}\Start Coding Agent.bat"; WorkingDir: "{app}"
Name: "{group}\Coding Agent"; Filename: "{app}\Start Coding Agent.bat"; WorkingDir: "{app}"
Name: "{group}\Change Model Key"; Filename: "{app}\Change Model Key.bat"; WorkingDir: "{app}"
Name: "{group}\Change Project Folder"; Filename: "{app}\Change Project Folder.bat"; WorkingDir: "{app}"
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"

[Run]
Filename: "{app}\Start Coding Agent.bat"; Description: "Launch Wrexlyn now"; Flags: postinstall shellexec skipifsilent nowait

[UninstallDelete]
; The first-run launcher generates these on the target machine (npm install / npm run build /
; first API-key+folder setup) — Inno Setup only auto-removes what it itself installed, so these
; need an explicit cleanup entry for the uninstaller to leave nothing behind.
Type: filesandordirs; Name: "{app}\node_modules"
Type: filesandordirs; Name: "{app}\dist"
Type: filesandordirs; Name: "{app}\.coding-agent"
Type: files; Name: "{app}\agent.config.json"
