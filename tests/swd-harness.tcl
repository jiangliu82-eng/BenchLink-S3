# Exercises swd-test.tcl with OpenOCD's Jim Tcl interpreter and fake target primitives.
set WDA_SCRATCH 0x20000000
set WDA_ITERATIONS 3
set original 0x11223344
set memory $original
set writes 0
set halts 0
set resumes 0
if {![info exists fake_state]} {set fake_state running}
set WDA_SCRIPTED 1
proc target {action} { return mock_target }
proc mock_target {action} { global fake_state; return $fake_state }
proc init {} {}
proc halt {} { global halts; incr halts }
proc wait_halt {args} {}
proc resume {} { global resumes; incr resumes }
proc sleep {args} {}
proc read_memory {address width count} {
    global memory WDA_SCRATCH
    if {$address == $WDA_SCRATCH} { return [list $memory] }
    return {0x410fc241}
}
proc write_memory {address width value} {
    global memory writes
    set memory [lindex $value 0]
    incr writes
}
rename shutdown real_shutdown
proc shutdown {args} {
    global original memory writes halts resumes
    global fake_state
    if {$fake_state eq "halted"} {
        if {$args ne "error" || $writes || $halts || $resumes} {error "Modified an initially halted target"}
        echo "WDA_TCL_HALTED_GUARD_PASS"
        real_shutdown
        return
    }
    if {[llength $args] || $memory != $original || $writes != 2 || $halts != 2 || $resumes != 2} {
        error "SWD script restoration or control assertions failed"
    }
    echo "WDA_TCL_HARNESS_PASS"
    real_shutdown
}
source [file join [file dirname [info script]] ../host/swd-test.tcl]
