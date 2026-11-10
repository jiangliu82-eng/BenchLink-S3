# BenchLink-S3 pairing guide (protocol v1)

[简体中文](PAIRING.md) · **English**

In the workbench, choose **Add device**, select the maintenance serial port, identify the probe, enter Wi-Fi credentials and wait for provisioning and mutual LAN authentication. The workbench obtains the IP automatically. Pairing does not require reflashing. Hardware checks on Windows verified serial identification and reconnection with an existing binding after a firmware update. First-time provisioning and binding replacement still require independent acceptance tests.

## Maintenance serial port

The onboard USB-to-serial bridge connects to UART0 (TX43 / RX44, 3.3 V, 115200 8N1). Native USB on GPIO19/20 remains available for USB Host. Check how the board’s download port is wired. A native USB port without a serial bridge cannot carry this protocol. The firmware disables the upstream UART1 REPL to avoid a second configuration path and password exposure through echo or command history.

Each frame is one UTF-8 line, `WDA1 {JSON}\n`. Requests carry `version=1`, a 24-character lowercase hexadecimal `requestId` and a `command`. Responses echo the ID and version and include `ok`, `deviceId` and `host`. Failures carry a fixed error code. The reader ignores logs and unrelated request IDs. The input limit is 1536 bytes per line. On overflow, the reader discards input through the next newline. The PC allows 35 seconds for the response and 40 seconds for the process.

- `identify` returns a stable `deviceId` derived from the station MAC address (`wda-xxxxxxxxxxxx`), pairing status (`paired`) and current IPv4 address. Credentials stay private.
- `provision` carries `deviceId`, `ssid`, `password` and `key`. The device commits the new random 256-bit binding key after Wi-Fi connects and NVS storage succeeds. Upstream WifiConfigManager rolls back failed network configuration. An NVS failure is reported explicitly. Wi-Fi and binding records occupy separate namespaces, so the network can change while the old binding remains valid.

Before sending `provision`, the PC saves the new key as a DPAPI-encrypted pending record. If the cable disconnects or the reply is lost, LAN verification can recover the record. An explicit rejection from the device restores the previous PC record. Failed LAN confirmation leaves pairing pending. Retrying over USB on a paired device requires confirmation to replace the binding. Stop tests and imported USB sessions before replacement.

## Wireless authentication and discovery

The device and PC decode the 64-character hexadecimal key to 32 bytes for HMAC-SHA256. `GET /api/wda/session?nonce=<32 hex>` returns the device ID, a random challenge and HMAC(`device\nID\nnonce\nchallenge`). The PC verifies the proof, then POSTs the challenge and HMAC(`client\nID\nchallenge`). The challenge is tied to the requester’s IPv4 address, expires after 30 seconds and is consumed on a verification attempt. The device returns HMAC(`ready\nID\nchallenge`) and grants that IPv4 address a 120-second lease. The PC refreshes it every 30 seconds.

UDP port 7211 accepts `type=wda-discover`, `deviceId` and `nonce`, and returns the device ID, nonce and HMAC(`discover\nID\nnonce`). The PC broadcasts on its IPv4 interfaces, checks the proof against the paired identity, then performs the HTTP challenge exchange. Matching an IP or device name alone is insufficient. Client isolation, VPNs or firewall rules that block broadcasts can prevent discovery.

New USB/IP and DAP connections require authorization. The firmware also checks each DAP request and USB root-port restart. USB/IP checks the lease on connection. An established USB/IP session can outlive the lease, so end old sessions before re-pairing.

This access control assumes a trusted LAN. Standard USB/IP and CMSIS-DAP TCP traffic is unencrypted. Source-IP authorization provides no per-packet authentication and cannot defend against an active LAN attacker or clients sharing the same NAT/IP. Keep these ports off the public internet. This board version does not implement an end-to-end encrypted tunnel, secure boot or NVS encryption.

## PC endpoints and storage

List ports with `GET /api/pairing/ports`. Use POST for `/api/pairing/identify`, `/api/pairing/provision` and `/api/pairing/reconnect`. Provisioning endpoints accept loopback connections and enforce the workbench Host, Origin and token checks. Pairing is performed outside MCP, so agents never receive the Wi-Fi password. To provision locally while serving LAN clients, bind to `0.0.0.0`, open the workbench on `127.0.0.1` and enter its token.

`%LOCALAPPDATA%/WDA-Studio/devices.json` stores device names, identities, last addresses and DPAPI ciphertext. The status API and event exports omit ciphertext, keys and Wi-Fi passwords. Run the service locally as the same Windows user. If storage is damaged or DPAPI decryption fails, the service preserves the file and requests re-pairing. Tests set `WDA_DEVICE_STORE` to an isolated temporary directory.

## Hardware acceptance checklist

1. With fresh firmware and no Wi-Fi settings, identify the device and enter a valid network. After confirmation, unplug the maintenance cable while keeping the device independently powered.
2. Enter a wrong password. Verify the error and recoverability of the previous network and binding. Check the NVS storage failure response using fault injection in a test build if needed.
3. Disconnect the cable during provisioning. Check that the workbench leaves pairing unconfirmed. Retry over USB or, if the device already stored the settings, recover the pending record over Wi-Fi.
4. Restart the S3, restart the PC service and change the DHCP address. Verify that the same device ID reconnects automatically and that an incorrect key cannot obtain a lease.
5. Pair over USB from a second PC. Check that replacement requires confirmation, new connections use the new binding and the old key fails authentication.
6. After pairing, run the USB, SWD and concurrent tests to check that maintenance UART0, USB Host and SWD can share the board without resource conflicts.
