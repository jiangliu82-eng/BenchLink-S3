$ErrorActionPreference='Stop'
Push-Location $PSScriptRoot
try {
    $compiler=Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
    & $compiler /nologo '/out:tests\FakeTool.exe' 'tests\FakeTool.cs'
    if($LASTEXITCODE -ne 0){throw 'Test helper compilation failed'}
    node tests/runner.test.mjs tests/FakeTool.exe
    if($LASTEXITCODE -ne 0){throw 'Runner regression failed'}
    node tests/channel-control.test.mjs
    if($LASTEXITCODE -ne 0){throw 'Channel control regression failed'}
    node tests/http.test.mjs
    if($LASTEXITCODE -ne 0){throw 'HTTP/MCP regression failed'}
    node tests/pairing.test.mjs
    if($LASTEXITCODE -ne 0){throw 'Pairing regression failed'}
    openocd -f tests/swd-harness.tcl
    if($LASTEXITCODE -ne 0){throw 'SWD Tcl regression failed'}
    openocd -c 'set fake_state halted' -f tests/swd-harness.tcl
    if($LASTEXITCODE -ne 0){throw 'SWD halted-target guard regression failed'}
} finally { Pop-Location }
