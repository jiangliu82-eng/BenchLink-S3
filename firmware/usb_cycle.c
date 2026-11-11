#include "esp_http_server.h"
#include "esp_log.h"
#include "hal/usb_dwc_ll.h"
#include "usb/usb_host.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"

extern bool wda_pairing_socket_allowed(int fd);

static const char *TAG = "wda-usb";
static SemaphoreHandle_t port_lock;
static bool restart_needs_power;

// Called with port_lock held. The explicit test and automatic recovery share the sequence.
static esp_err_t restart_root_port(void)
{
    esp_err_t err = usb_host_lib_set_root_port_power(false);
    if (err != ESP_OK) return err;
    restart_needs_power = true;
    vTaskDelay(pdMS_TO_TICKS(1000));
    err = usb_host_lib_set_root_port_power(true);
    if (err == ESP_OK) restart_needs_power = false;
    return err;
}

static bool connected_without_device(void)
{
    usb_host_lib_info_t info;
    if (usb_host_lib_info(&info) != ESP_OK ||
        !usb_dwc_ll_hprt_get_conn_status(USB_DWC_LL_GET_HW(0))) return false;
    // num_devices includes address-zero objects in this IDF version.
    uint8_t address;
    int count;
    return usb_host_device_addr_list_fill(1, &address, &count) == ESP_OK && count == 0;
}

static void monitor_root_port(void *arg)
{
    (void)arg;
    unsigned stalled_samples = 0;
    unsigned cooldown = 0;
    for (;;) {
        vTaskDelay(pdMS_TO_TICKS(5000));
        if (xSemaphoreTake(port_lock, 0) != pdTRUE) {
            stalled_samples = 0;
            continue;
        }
        if (restart_needs_power) {
            esp_err_t err = usb_host_lib_set_root_port_power(true);
            if (err == ESP_OK) restart_needs_power = false;
            else ESP_LOGW(TAG, "Root port enable retry: %s", esp_err_to_name(err));
            stalled_samples = 0;
        } else if (!connected_without_device()) {
            stalled_samples = 0;
            cooldown = 0;
        } else if (cooldown) {
            --cooldown;
        } else if (++stalled_samples >= 2) {
            // Recheck after the grace period. Enumeration can finish between samples.
            if (connected_without_device()) {
                ESP_LOGW(TAG, "Root port connected, no configured device; retrying enumeration");
                esp_err_t err = restart_root_port();
                if (err != ESP_OK) ESP_LOGW(TAG, "Root port restart: %s", esp_err_to_name(err));
                cooldown = 4;
            }
            stalled_samples = 0;
        }
        xSemaphoreGive(port_lock);
    }
}

static esp_err_t cycle_handler(httpd_req_t *request)
{
    if (!wda_pairing_socket_allowed(httpd_req_to_sockfd(request)))
        return httpd_resp_send_err(request, HTTPD_403_FORBIDDEN, "Pairing required");
    if (request->content_len != 0)
        return httpd_resp_send_err(request, HTTPD_400_BAD_REQUEST, "Expected empty body");
    xSemaphoreTake(port_lock, portMAX_DELAY);
    esp_err_t err = restart_root_port();
    xSemaphoreGive(port_lock);
    if (err != ESP_OK)
        return httpd_resp_send_err(request, HTTPD_500_INTERNAL_SERVER_ERROR, "Root port restart failed");
    httpd_resp_set_type(request, "application/json");
    return httpd_resp_sendstr(request, "{\"rootPortRestarted\":true}");
}

esp_err_t wda_register_usb_cycle(httpd_handle_t server)
{
    if (!port_lock) {
        port_lock = xSemaphoreCreateMutex();
        if (!port_lock) return ESP_ERR_NO_MEM;
        if (xTaskCreate(monitor_root_port, "wda-usb-watch", 3072, NULL, 3, NULL) != pdPASS) {
            vSemaphoreDelete(port_lock);
            port_lock = NULL;
            return ESP_ERR_NO_MEM;
        }
    }
    const httpd_uri_t route = { .uri = "/api/test/usb-cycle", .method = HTTP_POST,
                               .handler = cycle_handler };
    return httpd_register_uri_handler(server, &route);
}
