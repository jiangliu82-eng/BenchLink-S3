# BenchLink-S3｜通过 Wi-Fi 远程调试 MCU 与透传 USB

**简体中文** · [English](README.en.md)

BenchLink-S3 把实验台接入 Wi-Fi，让开发者和 AI Agent 远程调试 MCU、使用 USB 外设。支持 SWD、USB/IP 和 MCP。

硬件型号为 **WDA-S3**。调试器通过 2.4 GHz Wi-Fi 接入**与 Windows 开发机相同的局域网**。开发机可以使用 Wi-Fi 或网线接入，两台设备需能互访。

- **远程 SWD 调试**：目标板通过 SWD 接到 WDA-S3。开发机上的 OpenOCD 通过局域网连接调试器，GDB 即可暂停、单步和继续运行目标程序。
- **远程 USB 透传**：USB 外设插在 WDA-S3 的 USB Host 口。开发机通过 USB/IP 导入外设后，即可使用对应的 Windows 驱动和工具。

## ESP32-S3 开发板要求

**按本指南直接搭建，请选带两个独立 USB 数据接口的 ESP32-S3 开发板，模组须有至少 8 MB Flash，并配备 Octal PSRAM（八线 PSRAM）。** 本项目以 ESP32S3-COREBOARD 为参考。选用其他板型时，请对照原理图确认两个接口的实际接线：

| 参考板接口 | 板上接线 | 使用方式 |
| --- | --- | --- |
| USB1（下载 / 配网） | 经板载 USB 转串口桥连接 UART0，TX 为 GPIO43，RX 为 GPIO44 | 接 Windows 开发机，用于烧录固件、首次配网和绑定 |
| USB2（USB Host / OTG） | 数据线直连 ESP32-S3 原生 USB，D− 为 GPIO19，D+ 为 GPIO20 | 接需要透传的 USB 外设，由开发机通过 Wi-Fi 和 USB/IP 访问 |

如果开发板只引出了原生 USB 口，但同时引出了 UART0，可外接 **3.3 V 逻辑电平**的 USB 转串口模块补齐维护接口，原生 USB 口留给外设。

**USB 外设供电。** 对于依靠 USB 取电的外设，Host 口还需提供 5 V VBUS。参考板通过 USB-OTG 焊桥控制这条供电路径，接外设前请断电核对焊桥，再上电测量 VBUS。焊桥短接后，切勿将 USB2 接到电脑、充电器或其他会输出 5 V 的端口。[参考板焊桥与转接头说明](docs/WDA-S3-devboard-wiring.md)

**SWD 接线。** 开发板需能引出 GPIO11（SWDIO）、GPIO12（SWCLK）、GPIO13（低有效 nRESET）和 GND。目标板使用 3.3 V 逻辑，独立供电，并与调试器共地。

## 从源码构建与烧录

以下命令从本仓库根目录运行。构建机需要 Windows、Git、PowerShell 7 和 Python 3.12。先准备固定版本的上游源码。构建脚本会改写 USB/IP 工作副本并向其中复制适配文件，请为它使用专用目录。

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

## 首次配网与局域网连接

在 Windows 10/11 x64 开发机上安装 Node.js 22 或以上版本。首次配对时，用 USB 数据线将开发机接到 WDA-S3 的 USB1 口，然后启动 BenchLink-S3 工作台。

```powershell
./Start-Wda.ps1 -OpenBrowser
```

1. 在浏览器中选“添加设备”，选择 USB1 对应的 COM 口并识别调试器。
2. 填写 2.4 GHz Wi-Fi 名称和密码，使调试器加入开发机所在的局域网。
3. 等待串口配置和局域网认证均成功。在工作台查看 WDA-S3 的局域网 IP，后续 OpenOCD 和 USB/IP 命令均使用这个地址。为 WDA-S3 提供独立电源后，即可拔掉开发机与 USB1 之间的数据线，通过 Wi-Fi 继续调试。

默认工作台地址为 `http://127.0.0.1:7210`。保持工作台服务运行，在界面查看设备 IP。配对凭据由当前 Windows 用户的 DPAPI 保护。设备使用 TCP 80 做认证，UDP 7211 做发现。USB/IP 和 DAP 数据使用明文 TCP，请在可信局域网使用。[配对协议、换 IP 重连与恢复](docs/PAIRING.md)

### 无线 SWD 调试

安装带 CMSIS-DAP TCP 后端的 OpenOCD。用实际设备地址和目标芯片对应的 target 配置替换示例值，然后在另一终端启动目标 GDB。

```powershell
openocd -c "set WDA_HOST 192.0.2.10" -c "set TARGET_CFG target/stm32f4x.cfg" -f host/wda-swd.cfg
arm-none-eabi-gdb app.elf -ex "target extended-remote localhost:3333"
```

### USB 透传

安装 [usbip-win2 0.9.8.1 x64 驱动与客户端](https://github.com/vadimgrn/usbip-win2/releases/tag/v.0.9.8.1)。驱动安装可能重启 Windows USB Hub。将低功耗全速外设接到 S3 的 USB Host 口；使用实际 IP、枚举出的 busid 和导入端口执行：

```powershell
usbip list -r 192.0.2.10
usbip attach --once -r 192.0.2.10 -b 1-1
usbip port
# 使用导入设备；结束时将 1 换成本次导入的端口编号
usbip detach -p 1
```

### 连续读取与镜像比对

当短读正常、长读出现 `No ACK` 或数据不一致时，使用已知正确的原始二进制作为参照。安装 pyOCD 0.44.1 及目标芯片支持包，在工作台保持配对且 SWD 空闲时运行。将示例地址、型号、镜像起始地址和文件替换为实板配置。

```powershell
python tests/verify-swd.py --host 192.168.1.50 --target hc32f4a0pitb --base 0x14000 --hz 50000 original-app.bin 2>&1 | Tee-Object swd-readback.log
```

脚本以 attach 模式连接，检查芯片内存映射，逐块读取与镜像等长的 Flash 并逐字节比较。pyOCD 会执行目标驱动的连接初始化；HC32F4A0 驱动会设置调试控制寄存器。成功时输出实际读回长度和 SHA-256。传输失败时输出所在块和 DAP 响应头，并以非零状态退出。能关联到 TAR 写和连续 DRW 读时，`first_unreturned_address` 给出首个未返回的字地址。内容不符时输出首个不同字节的地址、期望值和实读值。每次重新运行从镜像起点开始。请使用已确认地址范围的 Flash 镜像。

## MCP

MCP 客户端使用 Streamable HTTP，地址为 `http://127.0.0.1:7210/mcp`。发布版提供两个工具：

| 工具 | probe | start |
| --- | --- | --- |
| `wda_debugger` | 查询 CMSIS-DAP 的 SWD 能力 | 通过 OpenOCD 读取 CPUID，暂停目标，写入并恢复专用 RAM，恢复运行并连续采样 |
| `wda_usb_passthrough` | 列出 USB/IP 设备及 busid、VID/PID | 导入指定设备，验证 Windows 枚举与实际负载，重启根端口后再次导入验证，最后释放 |

Codex 的 `[mcp_servers.wda]` 如设置了工具白名单，请使用 `enabled_tools = ["wda_debugger", "wda_usb_passthrough"]`。可通过 `codex mcp get wda` 核对当前配置。

配置目标后，调试工具还可直接执行 `read_cpuid`、`halt` 和 `resume`。例如 `{"action":"halt"}` 会实际暂停目标。USB 工具的 `{"action":"attach"}` 会把配置选定的外设持续导入 Windows，返回端口号，使用完毕以 `{"action":"detach"}` 释放。关闭 MCP 客户端后，已导入设备仍由 Windows 驱动管理。若目标复位会导致串口消失，可用 `{"action":"attach","autoReconnect":true}`。工作台运行期间每 30 秒核对绑定设备并尝试重新挂载配置的 busid、VID/PID。设备重新枚举后，等待目标固件就绪，再按 Windows 实际分配的 COM 号重新打开串口。使用 `detach` 停止自动挂载。

先用 `{"action":"probe"}` 核对连接。要运行预设测试，将 `host/config.example.json` 复制为 `host/config.local.json`，填入本机工具绝对路径、目标配置和专用的 4 字节对齐 RAM 地址，以及真实 USB busid、十进制 VID/PID、负载命令和成功输出。示例串口回环要求外设自身 TX/RX 短接，并将脚本路径与 COM7 改为本机实际值。停止旧服务后使用配置启动：

```powershell
./Start-Wda.ps1 -Config ./host/config.local.json -OpenBrowser
```

调用同一个工具的 `{"action":"start"}` 获得 id，再以 `{"action":"status","id":"返回的 UUID"}` 查询。运行中可用 `cancel`，结束后用 `report` 读取报告，两者都需要同一 id。自动化 SWD 测试要求目标初始处于运行态。测试超时或探针掉线后须检查目标状态和测试 RAM。USB 测试会断开同一根端口下的外设，请先退出手工导入或调试会话。

局域网客户端可在配对后用 `-BindAddress <Windows主机的局域网IPv4>` 重启服务，在客户端设置 `Authorization: Bearer <令牌>`。令牌在仓库根目录的 `.local-token`。本地配网接口只接受回环连接。请勿将服务暴露到公网。

## 验证与许可

在具备 Windows PowerShell、.NET Framework 4.x 编译器和 OpenOCD 的 Windows 机器上运行 `pwsh -File ./Test-Software.ps1`。套件使用假设备检验 USB/SWD 编排、MCP、配对、清理及 Tcl 脚本。开发板直连接线已在一块 HC32F4A0 目标板上实测：无线 SWD 读取 CPUID、暂停和恢复成功；Windows 可导入并打开全速 USB CDC 外设（0483:5740），重启 USB 根端口后可重新导入和打开。USB 导入期间也可读取目标 CPUID。持续业务收发、并发压力与专用 RAM 写入恢复尚待验证。

项目原创部分使用 **PolyForm Noncommercial License 1.0.0**，商业用途需另获授权。上游组件按各自许可证分发。[许可证全文](LICENSE) · [第三方组件与许可范围](THIRD-PARTY.md)
