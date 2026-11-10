# BenchLink-S3 第三方组件与许可范围

仓库根目录的 PolyForm Noncommercial 1.0.0 适用于本项目原创主机软件、固件适配以及随附文档。第三方代码、声明和相应权利继续受上游许可证约束。源码构建从固定上游检出组装固件。

| 组件 | 构建来源 | 许可证副本 |
| --- | --- | --- |
| ESP-IDF | espressif/esp-idf v5.5.1（fcae32885b0296b32044cb99ecbdc50d98dddb83） | [主项目 Apache-2.0](licenses/ESP-IDF.txt)，子组件见上游各目录 |
| USB/IP ESP32 应用 | yunsmall/usbipdcpp_esp32，4ae7c53515810e908aeafb39518a2466b3ef1ba3 | [Apache-2.0](licenses/usbipdcpp-esp32.txt) |
| usbipdcpp | yunsmall/usbipdcpp，7198c4b2547534599a6e7b92b1f67a0d0c4910fa | [LGPLv3](licenses/usbipdcpp.txt) 与其引用的 [GPLv3](licenses/GPL-3.0.txt) |
| CMSIS-DAP | ARM-software/CMSIS-DAP，12636590eec66fae2d1bba4518749426ad5a4595 | [Apache-2.0](licenses/CMSIS-DAP.txt) |
| ASIO、sock_utils、spdlog | ESP 组件管理器，版本及内容哈希见 [锁文件](dependencies.lock) | [ASIO](licenses/ASIO.txt)、[sock_utils](licenses/sock-utils.txt)、[spdlog 及 fmt 声明](licenses/spdlog.txt) |

`prepare-firmware.py` 向 usbipdcpp 的 Server.cpp 插入来源 IP 认证检查，该项对库的修改亦按 LGPLv3 提供。对 Arm DAP.h 的 Xtensa 延时适配及上游 ESP32 应用的启动、HTTP 守卫、USB/IP 控制传输完成长度与构建文件修改按各自的 Apache-2.0 提供。生成的文件保留上游声明，修改过程可从该脚本复核。分发重新编译的固件时，应随附适用许可、修改声明，并满足 LGPLv3 对相应库源码及重新链接等的要求。[GNU LGPLv3 正文与所引用的 GPLv3](https://www.gnu.org/licenses/lgpl-3.0.html)

OpenOCD、usbip-win2、GDB、Node.js 和 ESP-IDF 工具链由用户单独安装。
