# BenchLink-S3 配对指南（协议 v1）

在 BenchLink-S3 工作台为 WDA-S3 配网：添加设备 → 选择配置串口 → 识别 → 输入 Wi-Fi → 配网 → 局域网双向校验 → 完成。无需重新烧录或手填 IP。Windows 实板已验证维护串口识别和固件更新后的已有绑定重连。首次配网与绑定替换仍需独立验收。

## 配置串口

ESP32-S3 的板载 USB 转串口桥接 UART0（TX43 / RX44，3.3 V，115200 8N1）。原生 USB GPIO19/20 继续用于 USB Host。开发板 USB 下载口实际接线应先核对；没有转串口桥的原生 USB 口不能用于本协议。上游独立 UART1 REPL 不再启动，避免两个配置入口与密码回显/历史记录。

帧为 UTF-8 单行 `WDA1 {JSON}\n`，请求包含 version=1、24 位小写十六进制 requestId、command。响应回显 requestId/version，包含 ok/deviceId/host，失败返回固定 error code。读取端忽略日志和其他 requestId。最长输入行 1536 字节，溢出丢弃到换行；PC 读取响应最长 35 秒，进程最长 40 秒。

- identify：返回由 STA MAC 派生的稳定 deviceId（wda-xxxxxxxxxxxx）、paired、当前 IPv4。无凭据返回。
- provision：包含 deviceId、ssid、password、key。Wi-Fi 成功且 NVS 保存成功后，才提交新的 256 位随机绑定 key。失败网络配置由上游 WifiConfigManager 回滚。NVS 保存失败会明确报错；Wi-Fi 与绑定分属命名空间，不是跨命名空间原子事务，可能网络已改变而旧绑定仍有效。

PC 在发送 provision 前将新密钥经 DPAPI 加密保存为 pending 记录。串口断开或回复丢失不丢弃该记录，可经网络校验完成恢复；明确设备拒绝则恢复原有电脑记录。LAN 确认失败保留 pending，不提示配对成功。重试 USB 配网时设备若已绑定，需要再次确认替换。请在替换前停止测试和已导入 USB 会话。

## 无线认证与发现

设备与 PC 使用 HMAC-SHA256，密钥按 64 位十六进制解码为 32 字节。GET /api/wda/session?nonce=<32 hex> 返回 deviceId、随机 challenge 及 HMAC(`device\nID\nnonce\nchallenge`)。PC 校验后 POST challenge 与 HMAC(`client\nID\nchallenge`)。挑战绑定请求来源 IPv4，30 秒有效、验证尝试后即失效。设备返回 HMAC(`ready\nID\nchallenge`)，授予该 IPv4 120 秒连接许可，PC 每 30 秒刷新。

UDP 7211 接收 type=wda-discover、deviceId、nonce，返回 deviceId、nonce、HMAC(`discover\nID\nnonce`)。PC 对本机 IPv4 网卡广播，按已绑定身份验签，再执行 HTTP 挑战应答；不因发现同 IP 或同名称就认作原设备。交换机隔离、VPN、防火墙禁广播可能妨碍自动发现。

未经认证的新 USB/IP / DAP 连接被拒绝；DAP 每条请求及 USB 根端口重启也检查许可。USB/IP 许可在接入时检查，已经建立的 USB/IP 会话不会因租约到期自动断开；重新配对前需主动结束旧会话。

这是可信局域网的接入控制。标准 USB/IP 与 CMSIS-DAP TCP 数据不加密，按来源 IP 放行也不提供逐包身份保护，不能抵御同一 NAT/IP 或主动局域网攻击。不要将这些端口暴露到公网；面向不可信网络的端到端加密隧道、设备安全启动和 NVS 加密不在当前开发板版本中。

## PC 接口与存储

GET /api/pairing/ports；POST /api/pairing/identify、/provision、/reconnect。配网接口只允许回环来源，且继承 Host/Origin 与工作台令牌检查；没有 MCP 配网工具。Agent 不接收 Wi-Fi 密码。局域网模式若需同机配网，服务绑定 0.0.0.0，通过 127.0.0.1 访问并填入工作台令牌。

`%LOCALAPPDATA%/WDA-Studio/devices.json` 保存设备名称、身份、上次地址和 DPAPI 密文。状态 API 和事件导出不包含密文、密钥或 Wi-Fi 密码。只在本机当前用户启动服务；文件损坏或 DPAPI 无法解密时保留原文件并提示重新配对，不静默重建。测试通过 WDA_DEVICE_STORE 指向隔离临时目录。

## 到板验收

1. 全新固件、无 Wi-Fi：识别设备，输入正确网络，确认成功后拔配置线并保持独立供电。
2. 输入错误密码：显示失败，旧网络和旧绑定仍可恢复；验证 NVS 写失败返回（可用测试固件注入）。
3. 配网时拔线：不显示成功；重新插线可重试，或设备已保存时通过无线恢复 pending。
4. 重启 S3、重启 PC 服务、修改 DHCP 地址：同一 deviceId 自动恢复，错误密钥不能获得许可。
5. 第二台电脑重新 USB 配对：需确认替换，新连接使用新绑定；旧密钥不能再次认证。
6. 完成配对后再执行 USB、SWD、并发三项原测试，检查配网 UART0 与 Host/SWD 无资源冲突。
