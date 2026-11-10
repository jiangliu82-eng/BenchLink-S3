import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from functools import reduce
from operator import xor

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "host"))
from msp_ready import wait_ready

UID = "00112233445566778899aabb"
DEVICE = SimpleNamespace(device="COM36", serial_number=UID, vid=1155, pid=22336)


def frame(uid):
    data = bytes([12, 160]) + bytes.fromhex(uid)
    return b"$M>" + data + bytes([reduce(xor, data)])


class ReadinessTest(unittest.TestCase):
    def simulate(self, devices, responses):
        self.now = 0
        self.closed = 0
        self.writes = []
        def advance(t):
            self.now += t
        def opened(name):
            response = next(responses)
            if isinstance(response, Exception):
                raise response
            test = self
            class Port:
                def __enter__(self): return self
                def __exit__(self, *exc): test.closed += 1
                def reset_input_buffer(self): pass
                def write(self, data): test.writes.append(data)
                def read(self, size):
                    advance(.1)
                    return next(response, b"")
            return Port()
        return wait_ready(UID, 1155, 22336, lambda: next(devices, [DEVICE]), opened, timeout=5,
                          clock=lambda: self.now, sleep=advance)

    def test_reboot(self):
        good = frame(UID)
        bad = good[:-1] + bytes([good[-1] ^ 1])
        replies = [FileNotFoundError(2, "port absent"), OSError(433, "device missing"),
                   iter([bad]), iter([b"# CLI",good[:4],good[4:]]), iter([good])]
        result = self.simulate(iter([[]]), iter(replies))
        self.assertEqual((result["ready"],result["uid"],result["port"]), (True,UID,"COM36"))
        self.assertEqual([e["stage"] for e in result["events"]],
                         ["waiting_for_device","open_failed","open_failed","msp_failed","uid_verified"])
        self.assertEqual(self.closed, 3)
        self.assertEqual(self.writes, [b"$M<\x00\xa0\xa0"] * 3)

    def test_wrong_uid(self):
        result = self.simulate(iter([]), iter([iter([frame("00"*12)])]))
        self.assertFalse(result["ready"])
        self.assertEqual(result["events"][-1]["stage"], "uid_mismatch")

    def test_enumeration_alone_times_out(self):
        from itertools import repeat
        result = self.simulate(iter([]), repeat(OSError(433, "device missing")))
        self.assertFalse(result["ready"])
        self.assertEqual(result["elapsedMs"], 5000)

if __name__ == "__main__":
    unittest.main()
