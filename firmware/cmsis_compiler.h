// GCC/Xtensa definitions used by the Arm CMSIS-DAP command engine.
#pragma once
#define __STATIC_INLINE static inline
#define __STATIC_FORCEINLINE static inline __attribute__((always_inline))
#define __WEAK __attribute__((weak))
#define __NOP() __asm__ volatile("nop")
