# BenchLink-S3 | Remote MCU debugging and USB passthrough over Wi-Fi

[简体中文 / Bilingual README](README.md) · **English**

BenchLink-S3 lets developers and AI agents debug microcontrollers and use USB peripherals remotely over SWD, USB/IP and MCP. The **WDA-S3** probe joins the **same LAN as the Windows development PC** over 2.4 GHz Wi-Fi. The PC can use Ethernet or Wi-Fi. Both devices must be able to reach each other.

- **Wireless SWD debugging.** Wire the target to the probe. OpenOCD connects to the probe over the LAN so GDB can halt, single-step and resume the target.
- **USB passthrough.** Plug a peripheral into the probe’s USB Host port and import it over USB/IP. Windows applications can then use it through its usual driver.

## ESP32-S3 board requirements

Choose an ESP32-S3 board with **two independent USB data ports, at least 8 MB of flash and octal PSRAM**. The reference board is the ESP32S3-COREBOARD. On other boards, check the schematic for both connections.

| Reference port | Board connection | Purpose |
| --- | --- | --- |
| USB1 (flashing and setup) | Onboard USB-to-serial bridge to UART0, TX on GPIO43 and RX on GPIO44 | Connect to the Windows PC to flash firmware, configure Wi-Fi and pair |
| USB2 (USB Host / OTG) | Native ESP32-S3 USB, D− on GPIO19 and D+ on GPIO20 | Plug in the peripheral that Windows will access over Wi-Fi and USB/IP |

If the board only has a native USB port but exposes UART0, use an external USB-to-serial adapter with **3.3 V logic** for maintenance. Reserve the native port for the peripheral.

**Power for USB peripherals.** Bus-powered peripherals need 5 V on Host VBUS. On the reference board, the USB-OTG solder jumper controls this supply. Disconnect power before checking the jumper, then power up and measure VBUS. Once the jumper is closed, never connect USB2 to a PC, charger or another port that supplies 5 V. [Jumper and adapter wiring](docs/WDA-S3-devboard-wiring.en.md)

**SWD wiring.** Connect GPIO11 (SWDIO), GPIO12 (SWCLK), GPIO13 (active-low nRESET) and GND. Power the 3.3 V logic target independently and connect the grounds.

## Build and flash from source

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

Replace COM5 with the USB1 maintenance port. The scripts check upstream revisions, assemble the firmware using the lockfile and write three images and a SHA-256 manifest to `dist/firmware/`. Flashing verifies the hashes before writing at offsets 0x0, 0x8000 and 0x10000.

## First-time setup and LAN connection

Install Node.js 22 or later on a Windows 10/11 x64 PC. Connect USB1 to the PC with a data cable, then start the workbench.

```powershell
./Start-Wda.ps1 -OpenBrowser
```

1. Choose **Add device**, select the COM port for USB1 and identify the probe.
2. Enter the name and password of a 2.4 GHz Wi-Fi network on the same LAN as the PC.
3. Wait for serial provisioning and LAN authentication to succeed. Use the probe IP shown in the workbench for OpenOCD and USB/IP. Once the probe has independent power, unplug the USB1 data cable and continue over Wi-Fi.

The default workbench address is `http://127.0.0.1:7210`. Keep the service running to see the probe address. Windows DPAPI protects pairing credentials for the current user. Authentication uses TCP port 80 and discovery uses UDP port 7211. USB/IP and DAP carry unencrypted TCP traffic. Use a trusted LAN. [Pairing, DHCP address changes and recovery](docs/PAIRING.en.md)

### Wireless SWD debugging

Install OpenOCD with CMSIS-DAP TCP support. Substitute the probe address and the target configuration for your MCU. Start GDB for your target in a second terminal.

```powershell
openocd -c "set WDA_HOST 192.0.2.10" -c "set TARGET_CFG target/stm32f4x.cfg" -f host/wda-swd.cfg
arm-none-eabi-gdb app.elf -ex "target extended-remote localhost:3333"
```

### USB passthrough

After pairing once and installing usbip-win2, the background host checks the active WDA every two seconds and imports its USB peripherals into Windows. Rebooted or reinserted peripherals are imported again. Close the browser and use the usual device drivers and COM ports in your applications. Normal forwarding works without a test configuration. The default client is `C:/Program Files/USBip/usbip.exe`; use `usb.executable` for a custom location.

To start the host automatically when this Windows user signs in, register it once with `./Start-Wda.ps1 -InstallAtLogon`. Include the same `-Config` if you use a local configuration.

Install the [usbip-win2 0.9.8.1 x64 driver and client](https://github.com/vadimgrn/usbip-win2/releases/tag/v.0.9.8.1). Driver installation may restart the Windows USB hub. Connect a low-power, full-speed peripheral to the S3 Host port. Optionally inspect exports and Windows imports using the actual IP address.

```powershell
usbip list -r 192.0.2.10
usbip port
```

### Verify a continuous flash read against an image

If short reads succeed but longer reads return `No ACK` or inconsistent data, compare against a known-good raw binary. Install pyOCD 0.44.1 and the target support pack. Keep the workbench paired and SWD idle. Substitute the probe address, target type, image base address and reference file.

```powershell
python tests/verify-swd.py --host 192.168.1.50 --target hc32f4a0pitb --base 0x14000 --hz 50000 original-app.bin 2>&1 | Tee-Object swd-readback.log
```

The script attaches to the target, checks its memory map, then reads the image length from flash in blocks and compares every byte. pyOCD runs target-specific initialization on connection. The HC32F4A0 driver sets debug control registers. Success reports the actual byte count and SHA-256. A transfer error reports the block and DAP response header and exits with a nonzero status. When a TAR write can be correlated with consecutive DRW reads, `first_unreturned_address` identifies the first word that was not returned. A mismatch reports the first differing byte address and both expected and observed values. Each run starts at the image base. Verify the flash range before running.

## MCP

Connect a Streamable HTTP client to `http://127.0.0.1:7210/mcp`. The release exposes two tools.

| Tool | `probe` | `start` |
| --- | --- | --- |
| `wda_debugger` | Query CMSIS-DAP SWD capabilities | Use OpenOCD to read CPUID, halt, write and restore reserved RAM, resume and collect repeated samples |
| `wda_usb_passthrough` | List USB/IP devices with bus ID and VID/PID | Import the configured device, check Windows enumeration and run the workload, restart the root port, import and verify again, then release it |

If your Codex `[mcp_servers.wda]` section uses an allowlist, set `enabled_tools = ["wda_debugger", "wda_usb_passthrough"]`. Check the effective configuration with `codex mcp get wda`.

With a target configured, the debugger also accepts `read_cpuid`, `halt` and `resume`. Sending `{"action":"halt"}` halts the physical target. Automatic import is enabled by default after pairing. For maintenance, use `detach` on the configured device to release it and pause automatic imports for this host session. Use `attach` to resume.

**Optional bench diagnostic for flight controllers.** Normal forwarding and reattachment do not open the application port or send MSP traffic. Use this check only for independent verification after the application releases the port. For Betaflight targets that use the MCU UID as their USB serial number, set `usb.mspPython` in your local configuration to the absolute path of a Python 3 interpreter with pySerial installed (for example, run `python -m pip install pyserial` in a dedicated virtual environment). Match `usb.vid`, `usb.pid` and `usb.busid` to the target. Save its verified 12-byte MCU UID before reboot. After exiting the BF CLI and closing the factory application's serial handle, call the same MCP tool using the actual UID in place of the example.

```json
{"action":"wait_msp_uid","expectedUid":"00112233445566778899aabb"}
```

The workbench retries enumeration, opening the serial port and a read-only MSP_UID request for up to 45 seconds. It returns `ready: true`, the actual port and elapsed time after two consecutive independent opens of the same port each receive a checksum-valid reply with the expected UID. A valid response with a different UID fails immediately. Allow at least 55 seconds for the client request and use the returned port after success. Events distinguish enumeration waits, open failures and MSP response failures. This action verifies current communications without entering the CLI.

Start with `{"action":"probe"}`. To run preset tests, copy `host/config.example.json` to `host/config.local.json`. Set absolute tool paths, the target configuration, a dedicated 4-byte-aligned RAM address, the actual USB bus ID, decimal VID/PID, a workload command and its expected success output. For the example serial loopback, short TX to RX on the peripheral itself. Replace the script path and COM7 with local values. Stop the previous service before starting with this configuration.

```powershell
./Start-Wda.ps1 -Config ./host/config.local.json -OpenBrowser
```

Call `{"action":"start"}`, then pass the returned UUID to the same tool as `{"action":"status","id":"<returned UUID>"}`. Use `cancel` during a run or `report` after completion with the same ID. The SWD test requires the target to be running initially. After a timeout or probe disconnect, check target state and test RAM. The USB test disconnects devices under the same root port. Close manual import or debug sessions first.

For LAN clients, pair first, restart the service with `-BindAddress <Windows host LAN IPv4>` and set `Authorization: Bearer <token>` on the client. Find the token in `.local-token` at the repository root. Local provisioning endpoints accept loopback connections only. Keep the service off the public internet.

## Verification and license

Run `pwsh -File ./Test-Software.ps1` on Windows with Windows PowerShell, the .NET Framework 4.x compiler and OpenOCD. The suite uses simulated devices to test USB/SWD orchestration, MCP, pairing, cleanup and Tcl scripts. On one directly wired HC32F4A0 board, wireless SWD successfully read CPUID, halted and resumed the target. Windows imported and opened a full-speed USB CDC peripheral (0483:5740), then imported and opened it again after a USB root-port restart. CPUID reads also succeeded while USB was imported. Sustained application traffic, concurrent stress and reserved-RAM write/restore still need hardware verification.

Original project materials use **PolyForm Noncommercial License 1.0.0**. Commercial use requires separate permission. Upstream components retain their respective licenses. [Full license](LICENSE) · [Third-party components and scope](THIRD-PARTY.en.md)
