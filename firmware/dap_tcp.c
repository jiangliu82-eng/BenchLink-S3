#include <errno.h>
#include <stdbool.h>
#include <string.h>
#include <sys/time.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "lwip/sockets.h"
#include "esp_log.h"
#include "DAP_config.h"
#include "DAP.h"
extern bool wda_pairing_socket_allowed(int fd);

_Static_assert(WDA_CLK != WDA_DIO, "SWD pins must be distinct");
_Static_assert(WDA_CLK != 19 && WDA_CLK != 20 && WDA_DIO != 19 && WDA_DIO != 20,
               "GPIO19/20 belong to USB OTG");
_Static_assert(WDA_RST != WDA_CLK && WDA_RST != WDA_DIO && WDA_RST != 19 && WDA_RST != 20, "Reset must use a separate GPIO");
static const char *tag = "wda-dap";

static bool exchange_bytes(int sock, void *buffer, size_t size, bool sending) {
    uint8_t *p = buffer;
    while (size) {
        ssize_t n = sending ? send(sock, p, size, 0) : recv(sock, p, size, 0);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) return false;
        size -= n;
        p += n;
    }
    return true;
}

// Check variable-size commands before giving the Arm engine a buffer. TCP clients
// need not be OpenOCD; neither input reads nor generated output may exceed a packet.
static bool valid_packet(const uint8_t *p, size_t n) {
    size_t pos, out;
    switch (p[0]) {
    case 0x00: case 0x02: case 0x13: return n == 2;
    case 0x01: case 0x09: return n == 3;
    case 0x03: case 0x0a: return n == 1;
    case 0x04: case 0x08: return n == 6;
    case 0x10: return n == 7;
    case 0x11: return n == 5 && (p[1] || p[2] || p[3] || p[4]);
    case 0x12: return n >= 2 && n == 2 + ((p[1] ? p[1] : 256) + 7) / 8;
    case 0x05:
        if (n < 3) return false;
        pos = 3; out = 3;
        for (unsigned i = 0; i < p[2]; i++) {
            if (pos >= n) return false;
            uint8_t flags = p[pos++];
            if (flags & 0xe0) return false;
            if (!(flags & 2) || (flags & 0x10)) pos += 4;
            if ((flags & 2) && !(flags & 0x10)) out += 4;
        }
        return pos == n && out <= DAP_PACKET_SIZE;
    case 0x06: {
        if (n < 5) return false;
        unsigned count = p[2] | (p[3] << 8);
        return p[4] & 2 ? n == 5 && count <= (DAP_PACKET_SIZE - 4) / 4
                        : n == 5 + count * 4U;
    }
    case 0x1d:
        if (n < 2) return false;
        pos = 2; out = 2;
        for (unsigned i = 0; i < p[1]; i++) {
            if (pos >= n) return false;
            unsigned seq = p[pos++], bits = seq & 63;
            size_t bytes = ((bits ? bits : 64) + 7) / 8;
            if (seq & 0x80) out += bytes;
            else pos += bytes;
        }
        return pos == n && out <= DAP_PACKET_SIZE;
    default: return false;
    }
}

static void serve_client(int fd) {
    uint8_t request[DAP_PACKET_SIZE], response[DAP_PACKET_SIZE];
    const struct timeval timeout = { .tv_sec = 60 };
    setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
    setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout));
    DAP_Setup();
    for (;;) {
        uint8_t hdr[8];
        if (!exchange_bytes(fd, hdr, sizeof(hdr), false)) break;
        if (!wda_pairing_socket_allowed(fd)) break;
        size_t len = hdr[4] | (hdr[5] << 8);
        if (memcmp(hdr, "DAP", 4) || hdr[6] != 1 || hdr[7] || !len ||
            len > sizeof(request) || !exchange_bytes(fd, request, len, false)) break;
        size_t written = 1;
        response[0] = 0xff;
        if (valid_packet(request, len)) {
            written = DAP_ProcessCommand(request, response) & 0xffff;
        }
        if (!written || written > sizeof(response)) break;
        hdr[4] = written; hdr[5] = written >> 8; hdr[6] = 2;
        if (!exchange_bytes(fd, hdr, sizeof(hdr), true) ||
            !exchange_bytes(fd, response, written, true)) break;
    }
    PORT_OFF();
}

static void dap_task(void *unused) {
    const struct sockaddr_in addr = { .sin_family = AF_INET, .sin_port = htons(4441),
                                    .sin_addr.s_addr = htonl(INADDR_ANY) };
    for (;;) {
        int server = socket(AF_INET, SOCK_STREAM, 0);
        if (server >= 0) {
            int yes = 1;
            setsockopt(server, SOL_SOCKET, SO_REUSEADDR, &yes, sizeof(yes));
            if (!bind(server, (const struct sockaddr *)&addr, sizeof(addr)) && !listen(server, 1)) {
                ESP_LOGI(tag, "CMSIS-DAP TCP listening on 4441");
                for (;;) {
                    int client = accept(server, NULL, NULL);
                    if (client < 0) break;
                    if (wda_pairing_socket_allowed(client)) serve_client(client);
                    close(client);
                }
            }
            close(server);
        }
        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}
void wda_dap_start(void) {
    if (xTaskCreate(dap_task, "wda-dap", 8192, NULL, 4, NULL) != pdPASS)
        ESP_LOGE(tag, "Cannot start DAP task");
}
