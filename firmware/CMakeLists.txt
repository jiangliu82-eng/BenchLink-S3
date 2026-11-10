idf_component_register(
    SRCS "swd_wire.c" "dap_tcp.c" "usb_cycle.c" "arm/Source/DAP.c" "arm/Source/SW_DP.c"
    INCLUDE_DIRS "." "arm/Include"
    REQUIRES esp_driver_gpio esp_hw_support lwip usb esp_http_server)

set_source_files_properties("arm/Source/SW_DP.c" PROPERTIES COMPILE_DEFINITIONS "SWD_Transfer=wda_swd_transfer_bits")
