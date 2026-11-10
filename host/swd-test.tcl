init
if {[info exists WDA_SCRIPTED] && $WDA_SCRIPTED && [[target current] curstate] ne "running"} {
    echo "WDA_SWD_FAIL scripted SWD requires a running target"
    shutdown error
    return
}
set result [catch {
    halt
    wait_halt 2000
    set cpuid [read_memory 0xE000ED00 32 1]
    echo "WDA_CPUID $cpuid"
    set original [read_memory $WDA_SCRATCH 32 1]
    set memory_result [catch {
        write_memory $WDA_SCRATCH 32 {0x5aa5c33c}
        set actual [read_memory $WDA_SCRATCH 32 1]
        if {[lindex $actual 0] != 0x5aa5c33c} { error "Scratch RAM mismatch" }
    } memory_error]
    write_memory $WDA_SCRATCH 32 $original
    if {$memory_result} { error $memory_error }
    resume
    for {set i 0} {$i < $WDA_ITERATIONS} {incr i} {
        set id [read_memory 0xE000ED00 32 1]
        if {$id != $cpuid} { error "CPUID changed" }
        echo "WDA_SWD_SAMPLE $i $id"
        sleep 500
    }
    halt
    wait_halt 2000
    resume
    echo "WDA_SWD_PASS"
} failure]
if {$result} {
    echo "WDA_SWD_FAIL $failure"
    catch {resume}
    shutdown error
} else {
    shutdown
}
