@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0restore-attention-overlay.ps1" %*
