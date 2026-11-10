<#
.SYNOPSIS
    使用模拟设备运行主机和 OpenOCD 回归测试。
    Run host and OpenOCD regression tests with simulated devices.
#>
$ErrorActionPreference='Stop'
Push-Location $PSScriptRoot
try {
    $compiler=Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
    & $compiler /nologo '/out:tests\FakeTool.exe' 'tests\FakeTool.cs'
    if($LASTEXITCODE -ne 0){throw '测试辅助程序编译失败 / Test helper compilation failed'}
    node tests/runner.test.mjs tests/FakeTool.exe
    if($LASTEXITCODE -ne 0){throw '测试编排回归失败 / Runner regression failed'}
    node tests/channel-control.test.mjs
    if($LASTEXITCODE -ne 0){throw '通道控制回归失败 / Channel control regression failed'}
    node tests/http.test.mjs
    if($LASTEXITCODE -ne 0){throw 'HTTP/MCP 回归失败 / HTTP/MCP regression failed'}
    node tests/pairing.test.mjs
    if($LASTEXITCODE -ne 0){throw '配对回归失败 / Pairing regression failed'}
    openocd -f tests/swd-harness.tcl
    if($LASTEXITCODE -ne 0){throw 'SWD Tcl 回归失败 / SWD Tcl regression failed'}
    openocd -c 'set fake_state halted' -f tests/swd-harness.tcl
    if($LASTEXITCODE -ne 0){throw '已暂停目标保护机制回归失败 / SWD halted-target guard regression failed'}
} finally { Pop-Location }
