"""Wait for a Betaflight USB serial port and verify its MSP v1 MCU UID."""
import json
import sys
import time
from functools import reduce
from operator import xor


def read_uid(port, deadline, clock):
    port.reset_input_buffer()
    port.write(b'$M<\x00\xa0\xa0')  # MSP_UID (160), empty request
    header = b'$M>\x0c\xa0'
    data = bytearray()
    while clock() < deadline:
        data.extend(port.read(18))
        while True:
            pos = data.find(header)
            if pos < 0:
                del data[:-4]
                break
            del data[:pos]
            if len(data) < 18:
                break
            if reduce(xor, data[3:17]) == data[17]:
                return bytes(data[5:17]).hex()
            del data[0]
    raise TimeoutError('No complete MSP_UID reply with a valid checksum')


def wait_ready(uid, vid, pid, ports, open_port, timeout=45, clock=time.monotonic, sleep=time.sleep):
    start = clock()
    end = start + timeout
    previous = None
    events = []

    def note(stage, port=None, detail=None):
        event = {'stage': stage, 'port': port, 'detail': detail}
        if not events or any(events[-1][key] != val for key, val in event.items()):
            events.append(dict(event, elapsedMs=round((clock() - start) * 1000)))
            del events[:-32]

    def result(ok, **fields):
        return dict(ready=ok, elapsedMs=round((clock() - start) * 1000), events=events, **fields)

    while clock() < end:
        try:
            matches = [p.device for p in ports() if (p.vid, p.pid) == (vid, pid)
                       and (p.serial_number or '').lower() == uid]
        except OSError as exc:
            matches = []
            note('enumeration_failed', detail=str(exc))
        else:
            if not matches:
                note('waiting_for_device')
        if len(matches) > 1:
            return result(False, error='Multiple serial ports match the expected USB identity')
        if not matches:
            previous = None
        else:
            name = matches[0]
            try:
                port = open_port(name)
            except OSError as exc:
                previous = None
                note('open_failed', name, str(exc))
            else:
                try:
                    with port:
                        actual = read_uid(port, min(end, clock() + 1.2), clock)
                except OSError as exc:
                    previous = None
                    note('msp_failed', name, str(exc))
                else:
                    if actual != uid:
                        note('uid_mismatch', name, actual)
                        return result(False, error='MSP UID differs from expected UID')
                    note('uid_verified', name)
                    if previous == name:
                        return result(True, port=name, uid=actual)
                    previous = name
        sleep(min(0.25, max(0, end - clock())))
    return result(False, error='Timed out waiting for matching MSP_UID replies')


if __name__ == '__main__':
    import serial
    from serial.tools.list_ports import comports

    def open_port(name):
        port = serial.Serial(port=None, baudrate=115200, timeout=0.15, write_timeout=0.5)
        port.dtr = port.rts = False
        port.port = name
        port.open()
        return port

    print(json.dumps(wait_ready(sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), comports, open_port)))
