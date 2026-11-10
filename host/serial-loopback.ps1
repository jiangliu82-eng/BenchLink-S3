<#
.SYNOPSIS
    在指定 COM 口校验串口回环，先短接外设自身 TX/RX。 / Test serial loopback on the specified COM port. Short TX to RX on the peripheral first.
#>
param(
    [Parameter(Mandatory)][ValidatePattern('^COM[0-9]+$')][string]$Port,
    [int]$BaudRate=115200,
    [ValidateRange(1,10000)][int]$Packets=100
)
$ErrorActionPreference='Stop'
$serial=[System.IO.Ports.SerialPort]::new($Port,$BaudRate)
$serial.ReadTimeout=3000
$serial.WriteTimeout=3000
$serial.DtrEnable=$false
$serial.RtsEnable=$false
try {
    $serial.Open()
    $serial.DiscardInBuffer()
    $random=[System.Random]::new(12345)
    $sent=[byte[]]::new(64)
    $received=[byte[]]::new(64)
    $watch=[Diagnostics.Stopwatch]::StartNew()
    for($packet=0;$packet -lt $Packets;$packet++){
        $random.NextBytes($sent)
        $serial.Write($sent,0,$sent.Length)
        $count=0
        while($count -lt $sent.Length){
            $count += $serial.Read($received,$count,$received.Length-$count)
        }
        for($i=0;$i -lt $sent.Length;$i++){
            if($sent[$i] -ne $received[$i]){ throw "Packet $packet byte $i differs" }
        }
    }
    [pscustomobject]@{packets=$Packets;bytes=$Packets*64;elapsedMs=$watch.ElapsedMilliseconds} | ConvertTo-Json
    Write-Output 'WDA_USB_LOOPBACK_PASS'
} finally { $serial.Dispose() }
