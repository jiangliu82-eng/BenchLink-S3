#pragma once
#include <stdint.h>
#include <string.h>
#include "cmsis_compiler.h"
#include "sdkconfig.h"
#include "driver/gpio.h"
#include "esp_cpu.h"

#define CPU_CLOCK (CONFIG_ESP_DEFAULT_CPU_FREQ_MHZ * 1000000UL)
#define IO_PORT_WRITE_CYCLES 2U
#define DAP_SWD 1
#define DAP_JTAG 0
#define DAP_DEFAULT_PORT 1U
#define DAP_DEFAULT_SWJ_CLOCK 500000U
#define DAP_PACKET_SIZE 512U
#define DAP_PACKET_COUNT 1U
#define SWO_UART 0
#define SWO_MANCHESTER 0
#define SWO_STREAM 0
#define DAP_UART 0
#define DAP_UART_USB_COM_PORT 0
#define TIMESTAMP_CLOCK 0U
#define TARGET_FIXED 0
#define WDA_CLK CONFIG_WDA_SWCLK
#define WDA_DIO CONFIG_WDA_SWDIO
#define WDA_RST CONFIG_WDA_RESET

static inline uint8_t DAP_GetVendorString(char *s) { strcpy(s, "WDA"); return 4; }
static inline uint8_t DAP_GetProductString(char *s) { strcpy(s, "WDA-S3"); return 7; }
#define EMPTY_STRING(fn) static inline uint8_t fn(char *s) { (void)s; return 0; }
EMPTY_STRING(DAP_GetSerNumString)
EMPTY_STRING(DAP_GetTargetDeviceVendorString)
EMPTY_STRING(DAP_GetTargetDeviceNameString)
EMPTY_STRING(DAP_GetTargetBoardVendorString)
EMPTY_STRING(DAP_GetTargetBoardNameString)
EMPTY_STRING(DAP_GetProductFirmwareVersionString)

static inline void PORT_OFF(void) {
    gpio_set_direction(WDA_DIO, GPIO_MODE_INPUT);
    gpio_set_direction(WDA_CLK, GPIO_MODE_INPUT);
    gpio_set_level(WDA_RST, 1);
}
static inline void DAP_SETUP(void) {
    gpio_reset_pin(WDA_DIO);
    gpio_reset_pin(WDA_CLK);
    gpio_reset_pin(WDA_RST);
    gpio_set_level(WDA_RST, 1);
    gpio_set_direction(WDA_RST, GPIO_MODE_INPUT_OUTPUT_OD);
    PORT_OFF();
}
static inline void PORT_SWD_SETUP(void) {
    gpio_set_level(WDA_DIO, 1);
    gpio_set_level(WDA_CLK, 1);
    gpio_set_direction(WDA_DIO, GPIO_MODE_INPUT_OUTPUT);
    gpio_set_direction(WDA_CLK, GPIO_MODE_INPUT_OUTPUT);
}
#define PIN_SWCLK_TCK_IN() gpio_get_level(WDA_CLK)
#define PIN_SWCLK_TCK_SET() gpio_set_level(WDA_CLK, 1)
#define PIN_SWCLK_TCK_CLR() gpio_set_level(WDA_CLK, 0)
#define PIN_SWDIO_TMS_IN() gpio_get_level(WDA_DIO)
#define PIN_SWDIO_TMS_SET() gpio_set_level(WDA_DIO, 1)
#define PIN_SWDIO_TMS_CLR() gpio_set_level(WDA_DIO, 0)
#define PIN_SWDIO_IN() gpio_get_level(WDA_DIO)
#define PIN_SWDIO_OUT(bit) gpio_set_level(WDA_DIO, (bit) & 1U)
#define PIN_SWDIO_OUT_ENABLE() gpio_set_direction(WDA_DIO, GPIO_MODE_INPUT_OUTPUT)
#define PIN_SWDIO_OUT_DISABLE() gpio_set_direction(WDA_DIO, GPIO_MODE_INPUT)
#define PIN_nRESET_IN() gpio_get_level(WDA_RST)
#define PIN_nRESET_OUT(bit) gpio_set_level(WDA_RST, (bit) & 1U)
#define RESET_TARGET() 0U
#define LED_CONNECTED_OUT(bit) ((void)(bit))
#define LED_RUNNING_OUT(bit) ((void)(bit))
#define TIMESTAMP_GET() esp_cpu_get_cycle_count()
#define PIN_TDI_IN() 0U
#define PIN_TDI_OUT(bit) ((void)(bit))
#define PIN_TDO_IN() 0U
#define PIN_nTRST_IN() 1U
#define PIN_nTRST_OUT(bit) ((void)(bit))
