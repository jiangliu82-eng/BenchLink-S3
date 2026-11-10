#include "esp_http_server.h"
#include "usb/usb_host.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

extern bool wda_pairing_socket_allowed(int fd);
static esp_err_t cycle_handler(httpd_req_t *request) {
    if (!wda_pairing_socket_allowed(httpd_req_to_sockfd(request)))
        return httpd_resp_send_err(request, HTTPD_403_FORBIDDEN, "Pairing required");
    // Explicit POST with no payload is used by the bring-up runner.
    if (request->content_len != 0)
        return httpd_resp_send_err(request, HTTPD_400_BAD_REQUEST, "Expected empty body");
    esp_err_t off = usb_host_lib_set_root_port_power(false);
    if (off != ESP_OK)
        return httpd_resp_send_err(request, HTTPD_500_INTERNAL_SERVER_ERROR, "Root port unavailable");
    vTaskDelay(pdMS_TO_TICKS(1000));
    esp_err_t on = usb_host_lib_set_root_port_power(true);
    if (on != ESP_OK)
        return httpd_resp_send_err(request, HTTPD_500_INTERNAL_SERVER_ERROR, "Root port restart failed");
    httpd_resp_set_type(request, "application/json");
    return httpd_resp_sendstr(request, "{\"rootPortRestarted\":true}");
}
esp_err_t wda_register_usb_cycle(httpd_handle_t server) {
    const httpd_uri_t route = { .uri = "/api/test/usb-cycle", .method = HTTP_POST,
                               .handler = cycle_handler };
    return httpd_register_uri_handler(server, &route);
}
