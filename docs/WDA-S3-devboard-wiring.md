# BenchLink-S3 接线指南｜WDA-S3 开发板方案

依据 开发板厂商 ESP32-S3-SCH.pdf 第 1 页、firmware/Kconfig.projbuild、WdaPairing.cpp 与 usb_cycle.c。本指南适用于 ESP32S3-COREBOARD；实物模组容量、焊桥装配状态和目标板尚未核实。

1. PC 接 USB1（CH343P）。板载 UART0 的 TX43、RX44 已连好，115200 8N1。先核对模组支持镜像要求（至少 8 MB Flash、Octal PSRAM）；从项目根执行 pwsh -File ./Flash-S3.ps1 -Python <esptool解释器路径> -Port COM5（换成实际端口），再用 Start-Wda.ps1 -OpenBrowser 配对到 2.4 GHz 局域网。
2. SWD 目标独立供电，使用 3.3 V 逻辑，共地。J1-17 / GPIO11 到 SWDIO，J1-18 / GPIO12 到 SWCLK，J1-19 / GPIO13 到低有效 nRESET（目标端上拉），J1-22 到 GND。避免板载调试器同时驱动。SWD 测试配置需匹配目标芯片及可安全读写的 RAM。
3. USB2 直连 S3：D−=GPIO19，D+=GPIO20。USB-OTG（0 Ω / 0603）并联 D2，短接才能从板上 5 V 反向送到 USB2 VBUS；烧录、配对和 SWD 均可保持开路。断电拔线后先用万用表电阻/二极管档双向核对是否已装，不要误焊 IN-OUT 或 USB-JTAG。
4. 总线供电的 USB 测试外设：关电短接 USB-OTG，再由 USB1 供电，确认 USB2 VBUS 对地接近 5 V。USB2 的 CC1/CC2 均下拉 5.1 kΩ，板端没有 Type-C Source 公告。首轮用无源 Type-C 公转 USB-A 母数据转接头，接低功耗 USB-A 全速 USB 转 TTL 小板，短接其自身 TX/RX 做回环。不要把已短接的 USB2 再连 PC、充电器或另一主动送 5 V 的端口。开发板没有受控的 VBUS 限流开关；根端口重启只验证重新枚举，不能验证外设物理掉电。
5. 当前 UART0 是维护与配对口。目标 UART 可先由上述外置 USB 转 TTL 桥验证；与 3.3 V 目标互连时 TX 对 RX、RX 对 TX、GND 对 GND，各自供电，不连 VCC。GPIO15/16 的正式板目标串口不是本次开发板测试的已实现入口。
