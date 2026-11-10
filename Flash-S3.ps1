<#
.SYNOPSIS
    校验镜像并通过 USB1 维护串口烧录 WDA-S3。
    Verify the images and flash the WDA-S3 through its USB1 maintenance port.
.PARAMETER Port
    USB1 的维护串口，例如 COM5 / USB1 maintenance port, for example COM5.
.PARAMETER Python
    装有 esptool 的 Python 解释器路径 / Path to the Python interpreter with esptool installed.
.PARAMETER FirmwareDirectory
    镜像和 SHA-256 清单所在目录 / Directory containing the images and SHA-256 manifest.
#>
param(
    [Parameter(Mandatory)][ValidatePattern('^COM[0-9]+$')][string]$Port,
    [string]$Python,
    [string]$FirmwareDirectory=(Join-Path $PSScriptRoot 'dist/firmware')
)
$ErrorActionPreference='Stop'
if(!$Python){
    $local=Join-Path $PSScriptRoot 'local.paths.json'
    if(Test-Path -LiteralPath $local){$Python=(Get-Content -Raw $local|ConvertFrom-Json).python}
}
if(!$Python -or !(Test-Path -LiteralPath $Python)){throw '请用 -Python 指定已安装 esptool 的解释器 / Pass -Python pointing to an interpreter with esptool installed'}
$hashes=Get-Content -Raw (Join-Path $FirmwareDirectory 'sha256.json') | ConvertFrom-Json
foreach($entry in $hashes){
    $file=Join-Path $FirmwareDirectory $entry.File
    if((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $entry.Hash){throw "哈希不符 / Hash mismatch: $file"}
}
& $Python -m esptool --chip esp32s3 --port $Port --baud 460800 --before default_reset --after hard_reset write_flash --flash_mode dio --flash_size 8MB --flash_freq 80m 0x0 (Join-Path $FirmwareDirectory 'bootloader.bin') 0x8000 (Join-Path $FirmwareDirectory 'partition-table.bin') 0x10000 (Join-Path $FirmwareDirectory 'wda-s3.bin')
exit $LASTEXITCODE
