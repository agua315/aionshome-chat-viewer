@echo off
chcp 65001 >nul
title 聊天记录查看器 - 关闭本窗口即可停止
cd /d "%~dp0"
rem Prefer the bundled Node.js runtime; otherwise use the system Node.js.
set "VIEWER_NODE=%~dp0runtime\node.exe"
if not exist "%VIEWER_NODE%" (
    where node.exe >nul 2>nul
    if errorlevel 1 (
        echo 请先安装 Node.js 24 或更新版本，然后再次启动。
        pause
        exit /b 1
    )
    set "VIEWER_NODE=node.exe"
)
"%VIEWER_NODE%" "%~dp0app.js" --open
if errorlevel 1 pause
