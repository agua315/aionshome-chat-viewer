param(
    [ValidateRange(1024,65535)][int]$Port = 4328,
    [string]$ResultPath = ''
)
$ErrorActionPreference = 'Stop'
# 只放行本查看器的 TCP 端口，来源限同网段和 Tailscale IPv4；不改已有 AionsHome 规则。
if (-not $ResultPath) { $ResultPath = Join-Path $PSScriptRoot 'runtime\phone-firewall.json' }
$administrator = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $administrator) {
    $scriptText = "& '" + $PSCommandPath.Replace("'", "''") + "' -Port " + $Port + " -ResultPath '" + $ResultPath.Replace("'", "''") + "'"
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($scriptText))
    # 防火墙需要 Windows 管理员权限；后台辅助窗口隐藏，系统仍会正常显示 UAC 确认。
    try {
        $helper = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand',$encoded) -Verb RunAs -WindowStyle Hidden -PassThru -Wait
        exit $helper.ExitCode
    } catch {
        New-Item -ItemType Directory -Path (Split-Path -Parent $ResultPath) -Force | Out-Null
        @{ ok=$false; port=$Port; error=$_.Exception.Message } | ConvertTo-Json | Set-Content -LiteralPath $ResultPath -Encoding UTF8
        exit 1
    }
}
try {
    $viewerNodePath = Join-Path $PSScriptRoot 'runtime\node.exe'
    if (-not (Test-Path -LiteralPath $viewerNodePath)) { $viewerNodePath = (Get-Command node.exe -ErrorAction Stop).Source }
    $ruleName = 'AionsHomeChatViewer-' + $Port
    $ruleParameters = @{ DisplayName='AionsHome 聊天记录查看器（Wi-Fi / Tailscale）'; Direction='Inbound'; Action='Allow'; Enabled='True'; Profile='Any'; Protocol='TCP'; LocalPort=$Port; RemoteAddress=@('LocalSubnet','100.64.0.0/10'); Program=$viewerNodePath; EdgeTraversalPolicy='Block' }
    if (Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue) { Set-NetFirewallRule -Name $ruleName @ruleParameters | Out-Null }
    else { New-NetFirewallRule -Name $ruleName @ruleParameters | Out-Null }
    $result = @{ ok=$true; port=$Port; rule=$ruleName }
} catch { $result = @{ ok=$false; port=$Port; error=$_.Exception.Message } }
New-Item -ItemType Directory -Path (Split-Path -Parent $ResultPath) -Force | Out-Null
$result | ConvertTo-Json | Set-Content -LiteralPath $ResultPath -Encoding UTF8
if (-not $result.ok) { exit 1 }
