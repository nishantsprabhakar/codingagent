@echo off
title Coding Agent
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch.ps1" -ResetFolder
echo.
echo Coding Agent stopped.
pause >nul
