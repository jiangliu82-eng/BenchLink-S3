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
    Write-Host "Agent bearer token file: $tokenPath"
} else { Remove-Item Env:WDA_TOKEN -ErrorAction SilentlyContinue }
$url="http://127.0.0.1:$Port"
if($BindAddress -notin @('127.0.0.1','0.0.0.0')){ $url="http://$BindAddress"+":$Port" }
Write-Host "BenchLink-S3: $url"
Write-Host "MCP endpoint: $url/mcp"
if($OpenBrowser){ Start-Process $url }
& $node (Join-Path $PSScriptRoot 'host/server.mjs')
exit $LASTEXITCODE
