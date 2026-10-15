@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem Select the same Node.js runtime as the startup script.
set "VIEWER_NODE=%~dp0runtime\node.exe"
if not exist "%VIEWER_NODE%" (
    where node.exe >nul 2>nul
    if errorlevel 1 (
        echo 请先安装 Node.js 24 或更新版本。
        pause
        exit /b 1
    )
    set "VIEWER_NODE=node.exe"
)
"%VIEWER_NODE%" "%~dp0app.js" --stop
if errorlevel 1 pause
