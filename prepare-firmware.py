"""Prepare the pinned upstream USB/IP application with the WDA DAP component."""
import pathlib
import shutil
import sys
import subprocess
import re

root = pathlib.Path(__file__).resolve().parent
usb = pathlib.Path(sys.argv[1]).resolve()
arm = pathlib.Path(sys.argv[2]).resolve()
# These files are generated adapters in the pinned build checkout, not editable sources.
for relative in ["main/esp32_usbipdcpp.cpp", "main/CMakeLists.txt", "main/HttpConfigApi.cpp"]:
    (usb / relative).write_bytes(subprocess.check_output(["git", "-C", str(usb), "show", "HEAD:" + relative]))
submodule = usb / "components/usbipdcpp/usbipdcpp"
server_source = submodule / "src/Server.cpp"
server_source.write_bytes(subprocess.check_output(["git", "-C", str(submodule), "show", "HEAD:src/Server.cpp"]))
lock = root / "dependencies.lock"
if lock.exists():
    shutil.copy2(lock, usb / "dependencies.lock")
component = usb / "components" / "wda_dap"
shutil.copytree(root / "firmware", component, dirs_exist_ok=True)
for section, names in {"Source": ["DAP.c", "SW_DP.c"], "Include": ["DAP.h"]}.items():
    for name in names:
        dest = component / "arm" / section / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(arm / "Firmware" / section / name, dest)
shutil.copy2(arm / "LICENSE", component / "ARM-LICENSE")
header = component / "arm/Include/DAP.h"
text = header.read_text(encoding="utf-8")
start = text.index("#if defined(__CC_ARM)")
end = text.index("// Fixed delay", start)
text = text[:start] + """__STATIC_FORCEINLINE void PIN_DELAY_SLOW(uint32_t delay) {
  // DAP requests the number of CPU cycles to wait. Unsigned subtraction handles wrap.
  uint32_t start = esp_cpu_get_cycle_count();
  while ((uint32_t)(esp_cpu_get_cycle_count() - start) < delay) { __NOP(); }
}

""" + text[end:]
header.write_text(text, encoding="utf-8")
main = usb / "main/esp32_usbipdcpp.cpp"
text = main.read_text(encoding="utf-8")
start = text.index("    if (ConfigConsole::instance().init()")
end = text.index("\n    }", start) + len("\n    }")
text = text[:start] + "    // WDA USB UART0 provisioning replaces the legacy console." + text[end:]
text = re.sub(r"#if CONFIG_USBIPD_CFG_CONSOLE_ENABLE.*?#endif", "", text, flags=re.S)
text = 'extern "C" void wda_pairing_start(void);\n' + text
text = text.replace("    init_all();", "    init_all();\n    wda_pairing_start();")
marker = 'extern "C" void app_main(void) {'
declaration = 'extern "C" void wda_dap_start(void);'
text = declaration + "\n" + text.replace(declaration + "\n", "")
text = text.replace(marker + "\n    wda_dap_start();", marker)
network_ready = "    HttpConfigApi::instance().set_server(&server);"
if network_ready not in text:
    raise RuntimeError("USB/IP startup anchor changed")
if network_ready + "\n    wda_dap_start();" not in text:
    text = text.replace(network_ready, network_ready + "\n    wda_dap_start();")
main.write_text(text, encoding="utf-8")
cmake = usb / "main/CMakeLists.txt"
text = cmake.read_text(encoding="utf-8")
text = text.replace('"WifiConfigManager.cpp"', '"WifiConfigManager.cpp" "WdaPairing.cpp"')
text = text.replace("PRIV_REQUIRES ", "PRIV_REQUIRES json mbedtls esp_timer esp_driver_rmt ")
if "PRIV_REQUIRES wda_dap " not in text:
    text = text.replace("PRIV_REQUIRES ", "PRIV_REQUIRES wda_dap ")
    cmake.write_text(text, encoding="utf-8")
shutil.copy2(root / "firmware/WdaPairing.cpp", usb / "main/WdaPairing.cpp")
print(component)

api = usb / "main/HttpConfigApi.cpp"
text = api.read_text(encoding="utf-8")
text = text.replace("config.max_open_sockets = 4;", "config.max_open_sockets = 4;\n    config.max_uri_handlers = 12;")
text = 'extern "C" bool wda_pairing_socket_allowed(int fd);\n' + text
for method in ["handle_get_index", "handle_get_status", "handle_get_devices", "handle_post_wifi", "handle_post_ap", "handle_post_mode"]:
    pattern = r"(esp_err_t HttpConfigApi::" + method + r"\(httpd_req_t \*(\w+)\)\s*\{)"
    text, count = re.subn(pattern, lambda m: m[1] + '\n    if (!wda_pairing_socket_allowed(httpd_req_to_sockfd(' + m[2] + '))) return httpd_resp_send_err(' + m[2] + ', HTTPD_403_FORBIDDEN, "Use BenchLink-S3 USB pairing");', text)
    if count != 1:
        raise RuntimeError("HTTP access guard anchor changed: " + method)
if "wda_register_usb_cycle(server_)" not in text:
    text = 'extern "C" {\n#include "esp_http_server.h"\nesp_err_t wda_register_usb_cycle(httpd_handle_t server);\nesp_err_t wda_register_pairing(httpd_handle_t server);\n}\n' + text
    anchor = "    for (const httpd_uri_t *uri:"
    if anchor not in text:
        raise RuntimeError("HTTP registration anchor changed")
    text = text.replace(anchor, "    ESP_ERROR_CHECK(wda_register_usb_cycle(server_));\n    ESP_ERROR_CHECK(wda_register_pairing(server_));\n" + anchor)
    api.write_text(text, encoding="utf-8")

text = server_source.read_text(encoding="utf-8")
anchor = '            auto remote_endpoint_name = std::format('
if anchor not in text:
    raise RuntimeError("USB/IP acceptance anchor changed")
text = 'extern "C" bool wda_pairing_peer_allowed(const char *ip);\n' + text
text = text.replace(anchor, '            if (!wda_pairing_peer_allowed(remote_endpoint.address().to_string().c_str())) {\n                asio::error_code close_ec; session->socket.close(close_ec); continue;\n            }\n' + anchor)
server_source.write_text(text, encoding="utf-8")

# ESP-IDF includes the setup packet in the completion count for both
# directions. USB/IP RET_SUBMIT reports only the control data stage.
handler_path = "components/usbipdcpp/src/esp32_handler/Esp32DeviceHandler.cpp"
text = subprocess.check_output(["git", "-C", str(usb), "show", "HEAD:" + handler_path]).decode("utf-8")
anchor = "if (!cb->is_out && is_control) {\n            if (actual_length > USB_SETUP_PACKET_SIZE)"
if text.count(anchor) != 1:
    raise RuntimeError("USB/IP control completion length anchor changed")
fixed = "if (is_control) {\n            if (actual_length > USB_SETUP_PACKET_SIZE)"
(usb / handler_path).write_text(text.replace(anchor, fixed), encoding="utf-8")
