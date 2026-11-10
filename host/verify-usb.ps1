<#
.SYNOPSIS
    按 VID/PID 获取设备快照或核对新枚举的设备。 / Take a VID/PID snapshot or verify a newly enumerated Windows device.
#>
param(
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-fA-F]{4}$')][string]$Vid,
    [Parameter(Mandatory)][Alias('Pid')][ValidatePattern('^[0-9a-fA-F]{4}$')][string]$ProductId,
    [switch]$Snapshot,
    [string]$ExcludeJson='[]'
)
$ErrorActionPreference='Stop'
$Exclude=@(ConvertFrom-Json $ExcludeJson)
$pattern = 'USB\VID_' + $Vid + '&PID_' + $ProductId + '*'
if($Snapshot){
    $ids=@(Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -like $pattern } | Select-Object -ExpandProperty InstanceId)
    ConvertTo-Json -InputObject $ids -Compress
    exit 0
}
$deadline = [DateTime]::UtcNow.AddSeconds(20)
do {
    $devices = @(Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -like $pattern -and $_.Status -eq 'OK' -and $_.InstanceId -notin $Exclude })
    if ($devices.Count -gt 0) {
        $devices | Select-Object Status,Class,FriendlyName,InstanceId | ConvertTo-Json
        exit 0
    }
    Start-Sleep -Milliseconds 500
} while ([DateTime]::UtcNow -lt $deadline)
throw 'Matching USB device did not enumerate successfully in Windows'
