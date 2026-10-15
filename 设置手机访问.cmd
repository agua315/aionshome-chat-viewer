@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem Configure this viewer firewall rule; allow the Windows administrator prompt.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0设置手机访问防火墙.ps1"
if errorlevel 1 (
    echo 手机访问设置未完成，请重试并允许 Windows 的管理员确认。
) else (
    echo 防火墙已设置。启动查看器后，点击“手机访问”查看地址和访问码。
)
pause
