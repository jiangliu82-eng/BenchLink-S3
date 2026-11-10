import net from 'node:net';
import { pathToFileURL } from 'node:url';

// A probe uses its own short-lived connection. USB/IP DEVLIST and DAP_Info
// do not import a USB device or start an SWD session.
async function query(host, port, request, parse) {
  const socket = net.createConnection({ host, port });
  const deadline = setTimeout(() => socket.destroy(new Error('Probe timed out')), 4000);
  try {
    socket.once('connect', () => socket.write(request));
    let data = Buffer.alloc(0);
    for await (const chunk of socket) {
      data = Buffer.concat([data, chunk]);
      if (data.length > 256 * 1024) throw new Error('Response too large');
      const result = parse(data);
      if (result !== undefined) return result;
    }
    throw new Error('Connection closed before full response');
  } finally {
    clearTimeout(deadline);
    socket.destroy();
  }
}

export function parseDevices(data) {
  if (data.length < 12) return;
  if (data.readUInt16BE(0) !== 0x111 || data.readUInt16BE(2) !== 5 ||
      data.readUInt32BE(4) !== 0) throw new Error('Invalid USB/IP DEVLIST reply');
  const count = data.readUInt32BE(8);
  if (count > 128) throw new Error('Invalid USB/IP device count');
  const devices = [];
  let offset = 12;
  for (let index = 0; index < count; index++) {
    if (data.length < offset + 312) return;
    const desc = data.subarray(offset, offset + 312);
    const interfaces = desc[311];
    offset += 312 + 4 * interfaces;
    if (data.length < offset) return;
    devices.push({
      busid: desc.toString('ascii', 256, 288).split('\0')[0],
      vid: desc.readUInt16BE(300), pid: desc.readUInt16BE(302),
      speed: desc.readUInt32BE(296), interfaces,
    });
  }
  return devices;
}

export function listDevices(host, port = 3240) {
  return query(host, port, Buffer.from('0111800500000000', 'hex'), parseDevices);
}

export function probeDap(host, port = 4441) {
  // DAP_Info(0xF0) returns capabilities, including the SWD support bit.
  return query(host, port, Buffer.from('444150000200010000f0', 'hex'), data => {
    if (data.length < 8) return;
    const length = data.readUInt16LE(4);
    if (data.readUInt32LE(0) !== 0x00504144 || data[6] !== 2 || length < 3 ||
        length > 1024) throw new Error('Invalid DAP TCP header');
    if (data.length < 8 + length) return;
    if (data[8] !== 0 || data[9] + 2 !== length) throw new Error('Invalid DAP_Info reply');
    return { swd: Boolean(data[10] & 1) };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const host = process.argv[2];
  if (!host) throw new Error('Usage: node probe.mjs <WDA hostname or IP>');
  const results = await Promise.allSettled([listDevices(host), probeDap(host)]);
  for (const [i, result] of results.entries()) {
    console.log(['USB/IP', 'CMSIS-DAP'][i], result.value ?? result.reason.message);
    if (result.status === 'rejected') process.exitCode = 1;
  }
}
