<#
.SYNOPSIS
    启动 Windows 工作台。使用 -OpenBrowser 打开界面。
    Start the Windows workbench. Use -OpenBrowser to open the interface.
.PARAMETER Config
    本机测试配置文件 / Local test configuration file.
.PARAMETER BindAddress
    监听地址，默认仅本机 / Listen address, defaults to loopback.
.PARAMETER Port
    工作台和 MCP 的 HTTP 端口 / HTTP port for the workbench and MCP.
.PARAMETER OpenBrowser
    打开工作台网页 / Open the workbench in a browser.
#>
param(
    [string]$Config,
    [string]$BindAddress='127.0.0.1',
    [ValidateRange(1,65535)][int]$Port=7210,
    [switch]$OpenBrowser
)
$ErrorActionPreference='Stop'
$node=(Get-Command node -ErrorAction Stop).Source
if($Config){ $env:WDA_CONFIG=(Resolve-Path -LiteralPath $Config).Path }
else { Remove-Item Env:WDA_CONFIG -ErrorAction SilentlyContinue }
$env:WDA_BIND=$BindAddress
$env:WDA_PORT=[string]$Port
$env:WDA_REPORTS=Join-Path $PSScriptRoot 'reports'
if($BindAddress -ne '127.0.0.1'){
    $tokenPath=Join-Path $PSScriptRoot '.local-token'
    if(!(Test-Path -LiteralPath $tokenPath)){
        $bytes=[byte[]]::new(32)
        $rng=[Security.Cryptography.RandomNumberGenerator]::Create()
        try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
        [IO.File]::WriteAllText($tokenPath,[Convert]::ToBase64String($bytes))
    }
    $env:WDA_TOKEN=[IO.File]::ReadAllText($tokenPath).Trim()
    Write-Host "Agent 访问令牌文件 / Bearer token file: $tokenPath"
} else { Remove-Item Env:WDA_TOKEN -ErrorAction SilentlyContinue }
$url="http://127.0.0.1:$Port"
if($BindAddress -notin @('127.0.0.1','0.0.0.0')){ $url="http://$BindAddress"+":$Port" }
Write-Host "BenchLink-S3: $url"
Write-Host "MCP 端点 / MCP endpoint: $url/mcp"
if($OpenBrowser){ Start-Process $url }
& $node (Join-Path $PSScriptRoot 'host/server.mjs')
exit $LASTEXITCODE
