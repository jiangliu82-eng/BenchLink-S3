<#
.SYNOPSIS
    为工作台枚举串口、交换配网帧或用当前用户的 DPAPI 保护凭据。 / Enumerate ports, exchange setup frames or protect credentials using the current Windows user's DPAPI.
#>
param([ValidateSet('ports','exchange','protect','unprotect')][string]$Action)
$ErrorActionPreference='Stop'
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
try {
    if($Action -eq 'ports') {
        ConvertTo-Json -Compress -InputObject @([IO.Ports.SerialPort]::GetPortNames() | Sort-Object)
        exit 0
    }
    $inputData=[Console]::In.ReadToEnd() | ConvertFrom-Json
    if($Action -in @('protect','unprotect')) {
        Add-Type -AssemblyName System.Security
        if($Action -eq 'protect') {
            $bytes=[Text.Encoding]::UTF8.GetBytes($inputData.value)
            $result=[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($bytes,$null,'CurrentUser'))
        } else {
            $bytes=[Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($inputData.value),$null,'CurrentUser')
            $result=[Text.Encoding]::UTF8.GetString($bytes)
        }
        @{value=$result} | ConvertTo-Json -Compress
        exit 0
    }
    if($inputData.port -notmatch '^COM[1-9][0-9]{0,3}$'){throw 'Invalid port'}
    $port=[IO.Ports.SerialPort]::new($inputData.port,115200,'None',8,'One')
    $port.DtrEnable=$false; $port.RtsEnable=$false
    $port.Encoding=[Text.UTF8Encoding]::new($false)
    $port.ReadTimeout=500; $port.WriteTimeout=3000
    $port.Open()
    try {
        Start-Sleep -Milliseconds 250
        $port.DiscardInBuffer()
        $port.Write("WDA1 " + ($inputData.request | ConvertTo-Json -Compress -Depth 8) + "`n")
        $deadline=[DateTime]::UtcNow.AddSeconds(35)
        $buffer=''
        while([DateTime]::UtcNow -lt $deadline) {
            try { $buffer += [char]$port.ReadChar() } catch [TimeoutException] { continue }
            if($buffer.Length -gt 4096){$buffer=''}
            if($buffer.EndsWith("`n")) {
                $marker=$buffer.IndexOf('WDA1 ')
                if($marker -ge 0) {
                    try { $reply=$buffer.Substring($marker+5).Trim() | ConvertFrom-Json } catch { $reply=$null }
                    if($reply -and $reply.requestId -eq $inputData.request.requestId) {
                        $reply | ConvertTo-Json -Compress -Depth 8
                        exit 0
                    }
                }
                $buffer=''
            }
        }
        throw 'Device response timeout'
    } finally { $port.Close(); $port.Dispose() }
} catch {
    # Never include exception text: it may contain an input frame or credentials.
    [Console]::Error.WriteLine('Device operation failed. Check the port, cable and firmware; close serial monitors.')
    exit 1
}
