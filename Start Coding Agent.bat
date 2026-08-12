@echo off
title Wrexlyn
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch.ps1"
echo.
echo Wrexlyn stopped.
pause >nul
