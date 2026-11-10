idf_component_register(
    SRCS "dap_tcp.c" "usb_cycle.c" "arm/Source/DAP.c" "arm/Source/SW_DP.c"
    INCLUDE_DIRS "." "arm/Include"
    REQUIRES esp_driver_gpio esp_hw_support lwip usb esp_http_server)
