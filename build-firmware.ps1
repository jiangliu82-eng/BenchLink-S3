param(
    [Parameter(Mandatory)][string]$IdfPath,
    [Parameter(Mandatory)][string]$IdfToolsPath,
    [Parameter(Mandatory)][string]$UsbSource,
    [Parameter(Mandatory)][string]$DapSource,
    [string]$OutputDirectory=(Join-Path $PSScriptRoot 'dist/firmware')
)
$ErrorActionPreference='Stop'
$env:IDF_PATH=(Resolve-Path -LiteralPath $IdfPath).Path
$env:IDF_TOOLS_PATH=(Resolve-Path -LiteralPath $IdfToolsPath).Path
$usb=(Resolve-Path -LiteralPath $UsbSource).Path
$dap=(Resolve-Path -LiteralPath $DapSource).Path
$expected=@{
    $env:IDF_PATH='fcae32885b0296b32044cb99ecbdc50d98dddb83'
    $usb='4ae7c53515810e908aeafb39518a2466b3ef1ba3'
    $dap='12636590eec66fae2d1bba4518749426ad5a4595'
}
foreach($source in $expected.Keys){
    $actual=& git -C $source rev-parse HEAD
    if($LASTEXITCODE -ne 0 -or $actual -ne $expected[$source]){ throw "Unexpected source revision in $source" }
}
$submodule=& git -C (Join-Path $usb 'components/usbipdcpp/usbipdcpp') rev-parse HEAD
if($LASTEXITCODE -ne 0 -or $submodule -ne '7198c4b2547534599a6e7b92b1f67a0d0c4910fa'){throw 'Unexpected usbipdcpp submodule revision'}
$python=Join-Path $env:IDF_TOOLS_PATH 'python_env/idf5.5_py3.12_env/Scripts/python.exe'
if(!(Test-Path -LiteralPath $python)){ throw 'Install ESP-IDF 5.5 Python environment using Python 3.12 first' }
$lines=& $python (Join-Path $env:IDF_PATH 'tools/idf_tools.py') export --format key-value
if($LASTEXITCODE -ne 0){ throw 'ESP-IDF tool environment failed' }
foreach($line in $lines){
    if($line -match '^([A-Z_]+)=(.*)$'){
        [Environment]::SetEnvironmentVariable($Matches[1],$Matches[2].Replace('%PATH%',$env:PATH),'Process')
    }
}
& $python (Join-Path $PSScriptRoot 'prepare-firmware.py') $usb $dap
if($LASTEXITCODE -ne 0){ throw 'Source preparation failed' }
& $python (Join-Path $env:IDF_PATH 'tools/idf.py') -C $usb -D 'IDF_TARGET=esp32s3' -D 'SDKCONFIG_DEFAULTS=sdkconfig.defaults.esp32s3' build
if($LASTEXITCODE -ne 0){ throw 'Firmware compilation failed' }
New-Item -Force -ItemType Directory -Path $OutputDirectory | Out-Null
$build=Join-Path $usb 'build'
foreach($entry in @(
    @('bootloader/bootloader.bin','bootloader.bin'),
    @('partition_table/partition-table.bin','partition-table.bin'),
    @('usbipdcpp_esp32.bin','wda-s3.bin')
)){
    Copy-Item -LiteralPath (Join-Path $build $entry[0]) -Destination (Join-Path $OutputDirectory $entry[1])
}
Get-ChildItem -LiteralPath $OutputDirectory -Filter '*.bin' | Get-FileHash -Algorithm SHA256 |
    Select-Object Hash,@{Name='File';Expression={Split-Path $_.Path -Leaf}} |
    ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $OutputDirectory 'sha256.json')
