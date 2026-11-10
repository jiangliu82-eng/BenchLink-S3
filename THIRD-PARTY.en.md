# BenchLink-S3 third-party components and license scope

[简体中文](THIRD-PARTY.md) · **English**

The [PolyForm Noncommercial License 1.0.0](LICENSE) applies to the original host software, firmware adaptations and accompanying documentation. Third-party code, notices and rights remain subject to the relevant upstream licenses. Source builds assemble the firmware from pinned upstream checkouts.

| Component | Build source | License copy |
| --- | --- | --- |
| ESP-IDF | espressif/esp-idf v5.5.1 (fcae32885b0296b32044cb99ecbdc50d98dddb83) | [Apache-2.0 for the main project](licenses/ESP-IDF.txt). See upstream component directories for individual licenses. |
| ESP32 USB/IP application | yunsmall/usbipdcpp_esp32, 4ae7c53515810e908aeafb39518a2466b3ef1ba3 | [Apache-2.0](licenses/usbipdcpp-esp32.txt) |
| usbipdcpp | yunsmall/usbipdcpp, 7198c4b2547534599a6e7b92b1f67a0d0c4910fa | [LGPLv3](licenses/usbipdcpp.txt) and the [GPLv3](licenses/GPL-3.0.txt) it references |
| CMSIS-DAP | ARM-software/CMSIS-DAP, 12636590eec66fae2d1bba4518749426ad5a4595 | [Apache-2.0](licenses/CMSIS-DAP.txt) |
| ASIO, sock_utils, spdlog | ESP component manager. See the [lockfile](dependencies.lock) for versions and content hashes. | [ASIO](licenses/ASIO.txt), [sock_utils](licenses/sock-utils.txt), [spdlog and fmt notices](licenses/spdlog.txt) |

`prepare-firmware.py` inserts source-IP authorization checks in usbipdcpp’s Server.cpp. This modification to the library is available under LGPLv3. The Xtensa delay adaptation in Arm’s DAP.h and changes to the upstream ESP32 application (startup, HTTP access checks, USB/IP control-transfer completion length and build files) are available under their respective Apache-2.0 licenses. Generated files retain upstream notices. The script shows how each change is applied. When distributing rebuilt firmware, include applicable licenses and modification notices and meet the LGPLv3 requirements for corresponding library source and relinking. [GNU LGPLv3 and referenced GPLv3](https://www.gnu.org/licenses/lgpl-3.0.html)

Users install OpenOCD, usbip-win2, GDB, Node.js and the ESP-IDF toolchain separately.
