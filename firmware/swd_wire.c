#include "DAP_config.h"
#include "DAP.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

extern uint8_t wda_swd_transfer_bits(uint32_t request, uint32_t *data);

uint8_t SWD_Transfer(uint32_t request, uint32_t *data) {
    static portMUX_TYPE wire_lock = portMUX_INITIALIZER_UNLOCKED;
    // 8 request + 3 ACK + 33 data/parity + up to 8 turnaround clocks.
    // Include idle clocks and GPIO/loop overhead. Avoid masking interrupts at
    // very low SWCLK, and release the core between words, including WAIT retries.
    uint32_t clocks = 52U + DAP_Data.transfer.idle_cycles;
    uint32_t half_cycles = DAP_Data.fast_clock ? 1U : DAP_Data.clock_delay;
    if (half_cycles + 64U > (CPU_CLOCK / 1000U) / clocks) {
        return wda_swd_transfer_bits(request, data);
    }
    portENTER_CRITICAL(&wire_lock);
    uint8_t ack = wda_swd_transfer_bits(request, data);
    portEXIT_CRITICAL(&wire_lock);
    return ack;
}
