# BenchLink-S3 · Wi-Fi 远程 MCU 调试与 USB 透传 / Remote MCU debugging and USB passthrough over Wi-Fi

**简体中文 / English** · [English-only README](README.en.md)

BenchLink-S3 把实验台接入 Wi-Fi，让开发者和 AI Agent 远程调试 MCU、使用 USB 外设。支持 SWD、USB/IP 和 MCP。

BenchLink-S3 lets developers and AI agents debug microcontrollers and use USB peripherals remotely over SWD, USB/IP and MCP.

硬件型号为 **WDA-S3**。调试器通过 2.4 GHz Wi-Fi 接入**与 Windows 开发机相同的局域网**。开发机可以使用 Wi-Fi 或网线接入，两台设备需能互访。

The **WDA-S3** probe joins the **same LAN as the Windows development PC** over 2.4 GHz Wi-Fi. The PC can use Ethernet or Wi-Fi. Both devices must be able to reach each other.

- **远程 SWD 调试**：目标板通过 SWD 接到 WDA-S3。开发机上的 OpenOCD 通过局域网连接调试器，GDB 即可暂停、单步和继续运行目标程序。<br>**Wireless SWD debugging.** Wire the target to the probe. OpenOCD connects to the probe over the LAN so GDB can halt, single-step and resume the target.
- **远程 USB 透传**：USB 外设插在 WDA-S3 的 USB Host 口。开发机通过 USB/IP 导入外设后，即可使用对应的 Windows 驱动和工具。<br>**USB passthrough.** Plug a peripheral into the probe’s USB Host port and import it over USB/IP. Windows applications can then use it through its usual driver.

## ESP32-S3 开发板要求 / ESP32-S3 board requirements

**按本指南直接搭建，请选带两个独立 USB 数据接口的 ESP32-S3 开发板，模组须有至少 8 MB Flash，并配备 Octal PSRAM（八线 PSRAM）。** 本项目以 ESP32S3-COREBOARD 为参考。选用其他板型时，请对照原理图确认两个接口的实际接线：

Choose an ESP32-S3 board with **two independent USB data ports, at least 8 MB of flash and octal PSRAM**. The reference board is the ESP32S3-COREBOARD. On other boards, check the schematic for both connections.

| 参考板接口<br>Reference port | 板上接线<br>Board connection | 使用方式<br>Purpose |
| --- | --- | --- |
| USB1（下载 / 配网）<br>USB1 (flashing and setup) | 经板载 USB 转串口桥连接 UART0，TX 为 GPIO43，RX 为 GPIO44<br>Onboard USB-to-serial bridge to UART0, TX on GPIO43 and RX on GPIO44 | 接 Windows 开发机，用于烧录固件、首次配网和绑定<br>Connect to the Windows PC to flash firmware, configure Wi-Fi and pair |
| USB2（USB Host / OTG）<br>USB2 (USB Host / OTG) | 数据线直连 ESP32-S3 原生 USB，D− 为 GPIO19，D+ 为 GPIO20<br>Native ESP32-S3 USB, D− on GPIO19 and D+ on GPIO20 | 接需要透传的 USB 外设，由开发机通过 Wi-Fi 和 USB/IP 访问<br>Plug in the peripheral that Windows will access over Wi-Fi and USB/IP |

如果开发板只引出了原生 USB 口，但同时引出了 UART0，可外接 **3.3 V 逻辑电平**的 USB 转串口模块补齐维护接口，原生 USB 口留给外设。

If the board only has a native USB port but exposes UART0, use an external USB-to-serial adapter with **3.3 V logic** for maintenance. Reserve the native port for the peripheral.

**USB 外设供电。** 对于依靠 USB 取电的外设，Host 口还需提供 5 V VBUS。参考板通过 USB-OTG 焊桥控制这条供电路径，接外设前请断电核对焊桥，再上电测量 VBUS。焊桥短接后，切勿将 USB2 接到电脑、充电器或其他会输出 5 V 的端口。[参考板焊桥与转接头说明](docs/WDA-S3-devboard-wiring.md)

**Power for USB peripherals.** Bus-powered peripherals need 5 V on Host VBUS. On the reference board, the USB-OTG solder jumper controls this supply. Disconnect power before checking the jumper, then power up and measure VBUS. Once the jumper is closed, never connect USB2 to a PC, charger or another port that supplies 5 V. [Jumper and adapter wiring](docs/WDA-S3-devboard-wiring.en.md)

**SWD 接线。** 开发板需能引出 GPIO11（SWDIO）、GPIO12（SWCLK）、GPIO13（低有效 nRESET）和 GND。目标板使用 3.3 V 逻辑，独立供电，并与调试器共地。

**SWD wiring.** Connect GPIO11 (SWDIO), GPIO12 (SWCLK), GPIO13 (active-low nRESET) and GND. Power the 3.3 V logic target independently and connect the grounds.

## 从源码构建与烧录 / Build and flash from source

以下命令从本仓库根目录运行。构建机需要 Windows、Git、PowerShell 7 和 Python 3.12。先准备固定版本的上游源码。构建脚本会改写 USB/IP 工作副本并向其中复制适配文件，请为它使用专用目录。

Run the following from the repository root on Windows with Git, PowerShell 7 and Python 3.12. Use a dedicated checkout of the pinned upstream sources. The build script modifies the USB/IP working copy and copies the board adapters into it.

```powershell
mkdir upstream
git clone --branch v5.5.1 --recursive https://github.com/espressif/esp-idf upstream/esp-idf
git clone https://github.com/yunsmall/usbipdcpp_esp32 upstream/usbip
git -C upstream/usbip checkout 4ae7c53515810e908aeafb39518a2466b3ef1ba3
git -C upstream/usbip submodule update --init --recursive
git clone https://github.com/ARM-software/CMSIS-DAP upstream/dap
git -C upstream/dap checkout 12636590eec66fae2d1bba4518749426ad5a4595

$env:IDF_TOOLS_PATH = Join-Path $PWD 'upstream/idf-tools'
& ./upstream/esp-idf/install.ps1 esp32s3
./build-firmware.ps1 -IdfPath ./upstream/esp-idf -IdfToolsPath $env:IDF_TOOLS_PATH -UsbSource ./upstream/usbip -DapSource ./upstream/dap
$python = Join-Path $env:IDF_TOOLS_PATH 'python_env/idf5.5_py3.12_env/Scripts/python.exe'
./Flash-S3.ps1 -Port COM5 -Python $python
```

将 COM5 换成 USB1 的维护串口。脚本检查上游 Git 版本，根据锁文件组装固件，产出三个镜像及 SHA-256 清单到 `dist/firmware/`。烧录前会核对哈希，写入偏移分别为 0x0、0x8000、0x10000。

Replace COM5 with the USB1 maintenance port. The scripts check upstream revisions, assemble the firmware using the lockfile and write three images and a SHA-256 manifest to `dist/firmware/`. Flashing verifies the hashes before writing at offsets 0x0, 0x8000 and 0x10000.

## 首次配网与局域网连接 / First-time setup and LAN connection

在 Windows 10/11 x64 开发机上安装 Node.js 22 或以上版本。首次配对时，用 USB 数据线将开发机接到 WDA-S3 的 USB1 口，然后启动 BenchLink-S3 工作台。

Install Node.js 22 or later on a Windows 10/11 x64 PC. Connect USB1 to the PC with a data cable, then start the workbench.

```powershell
./Start-Wda.ps1 -OpenBrowser
```

1. 在浏览器中选“添加设备”，选择 USB1 对应的 COM 口并识别调试器。<br>Choose **Add device**, select the COM port for USB1 and identify the probe.
2. 填写 2.4 GHz Wi-Fi 名称和密码，使调试器加入开发机所在的局域网。<br>Enter the name and password of a 2.4 GHz Wi-Fi network on the same LAN as the PC.
3. 等待串口配置和局域网认证均成功。在工作台查看 WDA-S3 的局域网 IP，后续 OpenOCD 和 USB/IP 命令均使用这个地址。为 WDA-S3 提供独立电源后，即可拔掉开发机与 USB1 之间的数据线，通过 Wi-Fi 继续调试。<br>Wait for serial provisioning and LAN authentication to succeed. Use the probe IP shown in the workbench for OpenOCD and USB/IP. Once the probe has independent power, unplug the USB1 data cable and continue over Wi-Fi.

默认工作台地址为 `http://127.0.0.1:7210`。保持工作台服务运行，在界面查看设备 IP。配对凭据由当前 Windows 用户的 DPAPI 保护。设备使用 TCP 80 做认证，UDP 7211 做发现。USB/IP 和 DAP 数据使用明文 TCP，请在可信局域网使用。[配对协议、换 IP 重连与恢复](docs/PAIRING.md)

The default workbench address is `http://127.0.0.1:7210`. Keep the service running to see the probe address. Windows DPAPI protects pairing credentials for the current user. Authentication uses TCP port 80 and discovery uses UDP port 7211. USB/IP and DAP carry unencrypted TCP traffic. Use a trusted LAN. [Pairing, DHCP address changes and recovery](docs/PAIRING.en.md)

### 无线 SWD 调试 / Wireless SWD debugging

安装带 CMSIS-DAP TCP 后端的 OpenOCD。用实际设备地址和目标芯片对应的 target 配置替换示例值，然后在另一终端启动目标 GDB。

Install OpenOCD with CMSIS-DAP TCP support. Substitute the probe address and the target configuration for your MCU. Start GDB for your target in a second terminal.

```powershell
openocd -c "set WDA_HOST 192.0.2.10" -c "set TARGET_CFG target/stm32f4x.cfg" -f host/wda-swd.cfg
arm-none-eabi-gdb app.elf -ex "target extended-remote localhost:3333"
```

### USB 透传 / USB passthrough

一次配对并安装 usbip-win2 后，后台主机每两秒检查当前 WDA 的 USB 设备。插到 WDA 的外设会自动导入 Windows；设备重启或重新插入后会再次导入。可以关闭浏览器，业务软件照常使用外设驱动和 COM 口。普通透传无需测试配置，默认客户端路径为 `C:/Program Files/USBip/usbip.exe`，自定义路径可在 `usb.executable` 中指定。

After pairing once and installing usbip-win2, the background host checks the active WDA every two seconds and imports its USB peripherals into Windows. Rebooted or reinserted peripherals are imported again. Close the browser and use the usual device drivers and COM ports in your applications. Normal forwarding works without a test configuration. The default client is `C:/Program Files/USBip/usbip.exe`; use `usb.executable` for a custom location.

希望 Windows 登录后自动运行主机，可为当前用户执行一次 `./Start-Wda.ps1 -InstallAtLogon`。使用本机配置时一并传入相同的 `-Config`。

To start the host automatically when this Windows user signs in, register it once with `./Start-Wda.ps1 -InstallAtLogon`. Include the same `-Config` if you use a local configuration.

安装 [usbip-win2 0.9.8.1 x64 驱动与客户端](https://github.com/vadimgrn/usbip-win2/releases/tag/v.0.9.8.1)。驱动安装可能重启 Windows USB Hub。将低功耗全速外设接到 S3 的 USB Host 口；可选：使用实际 IP 检查导出列表和 Windows 导入状态。

Install the [usbip-win2 0.9.8.1 x64 driver and client](https://github.com/vadimgrn/usbip-win2/releases/tag/v.0.9.8.1). Driver installation may restart the Windows USB hub. Connect a low-power, full-speed peripheral to the S3 Host port. Optionally inspect exports and Windows imports using the actual IP address.

```powershell
usbip list -r 192.0.2.10
usbip port
```

### 连续读取与镜像比对 / Verify a continuous flash read against an image

当短读正常、长读出现 `No ACK` 或数据不一致时，使用已知正确的原始二进制作为参照。安装 pyOCD 0.44.1 及目标芯片支持包，在工作台保持配对且 SWD 空闲时运行。将示例地址、型号、镜像起始地址和文件替换为实板配置。

If short reads succeed but longer reads return `No ACK` or inconsistent data, compare against a known-good raw binary. Install pyOCD 0.44.1 and the target support pack. Keep the workbench paired and SWD idle. Substitute the probe address, target type, image base address and reference file.

```powershell
python tests/verify-swd.py --host 192.168.1.50 --target hc32f4a0pitb --base 0x14000 --hz 50000 original-app.bin 2>&1 | Tee-Object swd-readback.log
```

脚本以 attach 模式连接，检查芯片内存映射，逐块读取与镜像等长的 Flash 并逐字节比较。pyOCD 会执行目标驱动的连接初始化；HC32F4A0 驱动会设置调试控制寄存器。成功时输出实际读回长度和 SHA-256。传输失败时输出所在块和 DAP 响应头，并以非零状态退出。能关联到 TAR 写和连续 DRW 读时，`first_unreturned_address` 给出首个未返回的字地址。内容不符时输出首个不同字节的地址、期望值和实读值。每次重新运行从镜像起点开始。请使用已确认地址范围的 Flash 镜像。

The script attaches to the target, checks its memory map, then reads the image length from flash in blocks and compares every byte. pyOCD runs target-specific initialization on connection. The HC32F4A0 driver sets debug control registers. Success reports the actual byte count and SHA-256. A transfer error reports the block and DAP response header and exits with a nonzero status. When a TAR write can be correlated with consecutive DRW reads, `first_unreturned_address` identifies the first word that was not returned. A mismatch reports the first differing byte address and both expected and observed values. Each run starts at the image base. Verify the flash range before running.

## MCP

MCP 客户端使用 Streamable HTTP，地址为 `http://127.0.0.1:7210/mcp`。发布版提供两个工具：

Connect a Streamable HTTP client to `http://127.0.0.1:7210/mcp`. The release exposes two tools.

| 工具<br>Tool | `probe` | `start` |
| --- | --- | --- |
| `wda_debugger` | 查询 CMSIS-DAP 的 SWD 能力<br>Query CMSIS-DAP SWD capabilities | 通过 OpenOCD 读取 CPUID，暂停目标，写入并恢复专用 RAM，恢复运行并连续采样<br>Use OpenOCD to read CPUID, halt, write and restore reserved RAM, resume and collect repeated samples |
| `wda_usb_passthrough` | 列出 USB/IP 设备及 busid、VID/PID<br>List USB/IP devices with bus ID and VID/PID | 导入指定设备，验证 Windows 枚举与实际负载，重启根端口后再次导入验证，最后释放<br>Import the configured device, check Windows enumeration and run the workload, restart the root port, import and verify again, then release it |

Codex 的 `[mcp_servers.wda]` 如设置了工具白名单，请使用 `enabled_tools = ["wda_debugger", "wda_usb_passthrough"]`。可通过 `codex mcp get wda` 核对当前配置。

If your Codex `[mcp_servers.wda]` section uses an allowlist, set `enabled_tools = ["wda_debugger", "wda_usb_passthrough"]`. Check the effective configuration with `codex mcp get wda`.

配置目标后，调试工具还可直接执行 `read_cpuid`、`halt` 和 `resume`。例如 `{"action":"halt"}` 会实际暂停目标。USB 自动挂载在配对后默认启用。维护时可对已配置设备使用 `detach` 释放并暂停本次主机会话的自动挂载，用 `attach` 恢复。

With a target configured, the debugger also accepts `read_cpuid`, `halt` and `resume`. Sending `{"action":"halt"}` halts the physical target. Automatic import is enabled by default after pairing. For maintenance, use `detach` on the configured device to release it and pause automatic imports for this host session. Use `attach` to resume.

**可选台架诊断：飞控 MSP UID。** 日常 USB 透传和自动重挂不会打开业务串口或发送 MSP。仅在业务软件已释放串口、需要独立验收时使用此诊断。对使用 MCU UID 作为 USB 序列号的 Betaflight 飞控，可在本机配置的 `usb.mspPython` 填入已安装 pySerial 的 Python 3 解释器绝对路径（例如在专用虚拟环境中执行 `python -m pip install pyserial`）。`usb.vid`、`usb.pid` 和 `usb.busid` 应匹配目标飞控。重启前保存已确认的 12 字节 MCU UID。退出 BF CLI、释放工厂软件的串口句柄后，对同一 MCP 工具调用下面的动作，将示例 UID 换成实机值。

**Optional bench diagnostic for flight controllers.** Normal forwarding and reattachment do not open the application port or send MSP traffic. Use this check only for independent verification after the application releases the port. For Betaflight targets that use the MCU UID as their USB serial number, set `usb.mspPython` in your local configuration to the absolute path of a Python 3 interpreter with pySerial installed (for example, run `python -m pip install pyserial` in a dedicated virtual environment). Match `usb.vid`, `usb.pid` and `usb.busid` to the target. Save its verified 12-byte MCU UID before reboot. After exiting the BF CLI and closing the factory application's serial handle, call the same MCP tool using the actual UID in place of the example.

```json
{"action":"wait_msp_uid","expectedUid":"00112233445566778899aabb"}
```

工作台在 45 秒内重试枚举、打开串口和只读 MSP_UID 查询。只有连续两次独立打开同一串口、均收到校验正确且 UID 匹配的应答才返回 `ready: true`、实际端口和耗时。有效应答若返回其他 UID 会立即报错。客户端应留出至少 55 秒请求时间，成功后再使用返回的端口。事件记录可区分枚举等待、打开失败和 MSP 应答失败。该动作验证调用时的通信状态，不进入 CLI。

The workbench retries enumeration, opening the serial port and a read-only MSP_UID request for up to 45 seconds. It returns `ready: true`, the actual port and elapsed time after two consecutive independent opens of the same port each receive a checksum-valid reply with the expected UID. A valid response with a different UID fails immediately. Allow at least 55 seconds for the client request and use the returned port after success. Events distinguish enumeration waits, open failures and MSP response failures. This action verifies current communications without entering the CLI.

先用 `{"action":"probe"}` 核对连接。要运行预设测试，将 `host/config.example.json` 复制为 `host/config.local.json`，填入本机工具绝对路径、目标配置和专用的 4 字节对齐 RAM 地址，以及真实 USB busid、十进制 VID/PID、负载命令和成功输出。示例串口回环要求外设自身 TX/RX 短接，并将脚本路径与 COM7 改为本机实际值。停止旧服务后使用配置启动：

Start with `{"action":"probe"}`. To run preset tests, copy `host/config.example.json` to `host/config.local.json`. Set absolute tool paths, the target configuration, a dedicated 4-byte-aligned RAM address, the actual USB bus ID, decimal VID/PID, a workload command and its expected success output. For the example serial loopback, short TX to RX on the peripheral itself. Replace the script path and COM7 with local values. Stop the previous service before starting with this configuration.

```powershell
./Start-Wda.ps1 -Config ./host/config.local.json -OpenBrowser
```

调用同一个工具的 `{"action":"start"}` 获得 id，再以 `{"action":"status","id":"返回的 UUID"}` 查询。运行中可用 `cancel`，结束后用 `report` 读取报告，两者都需要同一 id。自动化 SWD 测试要求目标初始处于运行态。测试超时或探针掉线后须检查目标状态和测试 RAM。USB 测试会断开同一根端口下的外设，请先退出手工导入或调试会话。

Call `{"action":"start"}`, then pass the returned UUID to the same tool as `{"action":"status","id":"<returned UUID>"}`. Use `cancel` during a run or `report` after completion with the same ID. The SWD test requires the target to be running initially. After a timeout or probe disconnect, check target state and test RAM. The USB test disconnects devices under the same root port. Close manual import or debug sessions first.

局域网客户端可在配对后用 `-BindAddress <Windows主机的局域网IPv4>` 重启服务，在客户端设置 `Authorization: Bearer <令牌>`。令牌在仓库根目录的 `.local-token`。本地配网接口只接受回环连接。请勿将服务暴露到公网。

For LAN clients, pair first, restart the service with `-BindAddress <Windows host LAN IPv4>` and set `Authorization: Bearer <token>` on the client. Find the token in `.local-token` at the repository root. Local provisioning endpoints accept loopback connections only. Keep the service off the public internet.

## 验证与许可 / Verification and license

在具备 Windows PowerShell、.NET Framework 4.x 编译器和 OpenOCD 的 Windows 机器上运行 `pwsh -File ./Test-Software.ps1`。套件使用假设备检验 USB/SWD 编排、MCP、配对、清理及 Tcl 脚本。开发板直连接线已在一块 HC32F4A0 目标板上实测：无线 SWD 读取 CPUID、暂停和恢复成功；Windows 可导入并打开全速 USB CDC 外设（0483:5740），重启 USB 根端口后可重新导入和打开。USB 导入期间也可读取目标 CPUID。持续业务收发、并发压力与专用 RAM 写入恢复尚待验证。

Run `pwsh -File ./Test-Software.ps1` on Windows with Windows PowerShell, the .NET Framework 4.x compiler and OpenOCD. The suite uses simulated devices to test USB/SWD orchestration, MCP, pairing, cleanup and Tcl scripts. On one directly wired HC32F4A0 board, wireless SWD successfully read CPUID, halted and resumed the target. Windows imported and opened a full-speed USB CDC peripheral (0483:5740), then imported and opened it again after a USB root-port restart. CPUID reads also succeeded while USB was imported. Sustained application traffic, concurrent stress and reserved-RAM write/restore still need hardware verification.

项目原创部分使用 **PolyForm Noncommercial License 1.0.0**，商业用途需另获授权。上游组件按各自许可证分发。[许可证全文](LICENSE) · [第三方组件与许可范围](THIRD-PARTY.md)

Original project materials use **PolyForm Noncommercial License 1.0.0**. Commercial use requires separate permission. Upstream components retain their respective licenses. [Full license](LICENSE) · [Third-party components and scope](THIRD-PARTY.en.md)
