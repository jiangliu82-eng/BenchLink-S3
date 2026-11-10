"""Compare target flash to a raw image over BenchLink CMSIS-DAP/TCP (pyOCD 0.44.1). 通过 SWD 逐字节比对目标 Flash 和原始镜像。"""
import argparse
from collections import deque
import hashlib
import json
import socket
import struct
import sys
from pathlib import Path

from pyocd.core.session import Session
from pyocd.probe.cmsis_dap_probe import CMSISDAPProbe
from pyocd.probe.pydapaccess.dap_access_cmsis_dap import DAPAccessCMSISDAP
from pyocd.probe.pydapaccess.interface.interface import Interface


class DapTcp(Interface):
    header = struct.Struct("<IHBB")

    def __init__(self, host):
        super().__init__()
        self.host = host
        self.vendor_name = "WDA"
        self.product_name = "BenchLink-S3"
        self.serial_number = f"tcp://{host}:4441"
        self.failure = None
        self.last_transfer = None
        self.requests = deque()
        self.block = None
        self.cursor = None
        self.first_unreturned = None

    def open(self):
        self.sock = socket.create_connection((self.host, 4441), timeout=15)
        self.sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)

    def close(self):
        self.sock.close()

    def write(self, data):
        self.sock.sendall(self.header.pack(0x504144, len(data), 1, 0) + bytes(data))
        self.requests.append(bytes(data[:9]))

    def read_exactly(self, size):
        data = bytearray()
        while len(data) < size:
            chunk = self.sock.recv(size - len(data))
            if not chunk:
                raise EOFError("CMSIS-DAP/TCP disconnected mid-frame")
            data.extend(chunk)
        return data

    def read(self):
        magic, size, kind, reserved = self.header.unpack(self.read_exactly(8))
        if magic != 0x504144 or kind != 2 or reserved or not 1 <= size <= 512:
            raise ValueError("Invalid BenchLink CMSIS-DAP/TCP frame")
        data = self.read_exactly(size)
        request = self.requests.popleft()
        if request[0] != data[0]:
            raise ValueError(f"unexpected DAP response {data[0]:#04x} for {request[0]:#04x}")
        if data[0] in (5, 6):
            prefix = 3 if data[0] == 5 else 4
            if size < prefix:
                raise ValueError("Truncated DAP transfer response")
            self.last_transfer = data[:prefix].hex()
            if data[prefix - 1] != 1 and self.failure is None:
                self.failure = self.last_transfer
        self.track_block(request, data)
        return data

    def track_block(self, request, response):
        # Correlate pyOCD's word-aligned MEM-AP TAR write and subsequent DRW reads.
        # Other command sequences fall back to reporting the enclosing block.
        if self.block and request[0] == 6 and len(request) >= 5:
            count = int.from_bytes(request[2:4], "little")
            done = int.from_bytes(response[1:3], "little")
            status = response[3]
            if request[4] == 0x05 and count == done == 1 and status == 1:
                address = int.from_bytes(request[5:9], "little")
                self.cursor = address if self.block[0] <= address < self.block[1] else None
                return
            if request[4] == 0x0f and self.cursor is not None and self.cursor + count * 4 <= self.block[1]:
                self.cursor += done * 4
                if status != 1 and done < count and self.first_unreturned is None:
                    self.first_unreturned = hex(self.cursor)
                return
        self.cursor = None


def verify(args, image, interface):
    probe = CMSISDAPProbe(DAPAccessCMSISDAP(None, interface=interface))
    options = {"target_override": args.target, "frequency": args.hz, "connect_mode": "attach",
               "auto_unlock": False, "resume_on_disconnect": False, "cmsis_dap.limit_packets": True,
               "cmsis_dap.deferred_transfers": False, "allow_no_cores": False}
    address = args.base
    digest = hashlib.sha256()
    try:
        with Session(probe, options=options) as session:
            end = args.base + len(image)
            cursor = args.base
            while cursor < end:
                region = session.target.memory_map.get_region_for_address(cursor)
                if region is None or not region.is_flash:
                    raise ValueError(f"target has no declared flash at {cursor:#010x}")
                cursor = region.end + 1
            for offset in range(0, len(image), 1024):
                address = args.base + offset
                expected = image[offset:offset + 1024]
                interface.block = (address, address + len(expected)) if not (address % 4 or len(expected) % 4) else None
                interface.cursor = None
                actual = bytes(session.target.read_memory_block8(address, len(expected)))
                if len(actual) != len(expected):
                    raise ValueError(f"short read: {len(actual)}/{len(expected)}")
                if actual != expected:
                    pos = next(i for i in range(len(actual)) if actual[i] != expected[i])
                    raise ValueError(f"mismatch at {address + pos:#010x}: expected "
                                     f"{expected[pos]:02x}, received {actual[pos]:02x}")
                digest.update(actual)
                if offset % 65536 == 0:
                    print(f"verified through {address + len(actual) - 1:#010x}", flush=True)
        if interface.failure is not None:
            raise ValueError("DAP reported a failed transfer during this session")
    except Exception as error:
        print(json.dumps({"block": hex(address), "error": str(error),
                          "first_unreturned_address": interface.first_unreturned,
                          "failed_dap_response": interface.failure,
                          "last_dap_response": interface.last_transfer}), file=sys.stderr, flush=True)
        return 1
    print(f"PASS {len(image)} bytes SHA-256 {digest.hexdigest()}")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", required=True, help="probe IP address / 探针 IP 地址")
    parser.add_argument("--target", required=True, help="installed pyOCD target name / 已安装的 pyOCD 目标型号")
    parser.add_argument("--base", required=True, help="flash image base address / 镜像在 Flash 中的起始地址", type=lambda s: int(s, 0))
    parser.add_argument("--hz", help="SWD clock in Hz / SWD 时钟频率（Hz）", type=int, default=50000)
    parser.add_argument("image", type=Path, help="known-good raw binary / 已验证的原始二进制镜像")
    args = parser.parse_args()
    image = args.image.read_bytes()
    if not image or args.base < 0 or args.base + len(image) > 2**32 or not 0 < args.hz <= 2**32-1:
        parser.error("expected a non-empty image, 32-bit address range and positive SWD clock")
    sys.exit(verify(args, image, DapTcp(args.host)))
