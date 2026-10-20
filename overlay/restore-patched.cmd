@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0restore-patched.ps1" %*
pause
