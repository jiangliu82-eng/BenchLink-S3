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
.PARAMETER InstallAtLogon
    为当前用户注册后台登录启动任务 / Register a background logon task for this Windows user.
.PARAMETER DeviceStore
    当前用户的配对记录目录 / Directory containing this user's pairing records.
#>
param(
    [string]$Config,
    [string]$BindAddress='127.0.0.1',
    [ValidateRange(1,65535)][int]$Port=7210,
    [switch]$OpenBrowser,
    [switch]$InstallAtLogon,
    [string]$DeviceStore
)
$ErrorActionPreference='Stop'
$node=(Get-Command node -ErrorAction Stop).Source
if($DeviceStore){$env:WDA_DEVICE_STORE=[IO.Path]::GetFullPath($DeviceStore)}
if($Config){ $env:WDA_CONFIG=(Resolve-Path -LiteralPath $Config).Path }
else { Remove-Item Env:WDA_CONFIG -ErrorAction SilentlyContinue }
if($InstallAtLogon){
    $ip=$null
    if(![Net.IPAddress]::TryParse($BindAddress,[ref]$ip)){throw 'Use a numeric bind address'}
    $user=[Security.Principal.WindowsIdentity]::GetCurrent().Name
    $arguments='-NoProfile -WindowStyle Hidden -File "'+$PSCommandPath+'" -BindAddress '+$ip+' -Port '+$Port
    if($Config){$arguments+=' -Config "'+$env:WDA_CONFIG+'"'}
    $store=if($env:WDA_DEVICE_STORE){$env:WDA_DEVICE_STORE}else{Join-Path $env:LOCALAPPDATA 'WDA-Studio'}
    $file=Join-Path $store 'devices.json'
    if(Test-Path -LiteralPath $file){
        # Packaged launchers can redirect LocalAppData; the logon task runs outside the launcher.
        $actualFile=& $node -e "console.log(require('node:fs').realpathSync.native(process.argv[1]))" $file
        if($LASTEXITCODE -ne 0){throw 'Unable to resolve the pairing store'}
        $store=Split-Path -LiteralPath $actualFile
    }
    $arguments+=' -DeviceStore "'+$store+'"'
    $action=New-ScheduledTaskAction -Execute (Get-Command pwsh -ErrorAction Stop).Source -Argument $arguments -WorkingDirectory $PSScriptRoot
    $settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName ("BenchLink-S3-"+$env:USERNAME+"-"+$Port) -Action $action -Settings $settings -Trigger (New-ScheduledTaskTrigger -AtLogOn -User $user) -User $user -RunLevel Limited -Force | Out-Null
    return
}
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
