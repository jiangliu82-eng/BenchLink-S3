import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDevices } from './probe.mjs';

const execute = promisify(execFile);

export async function waitMspUid(usb, expectedUid, signal) {
  if (!usb?.mspPython || !path.isAbsolute(usb.mspPython))
    throw Error('Set usb.mspPython to an absolute Python path with pyserial installed');
  if (![usb.vid, usb.pid].every(n => Number.isInteger(n) && n >= 0 && n <= 65535))
    throw Error('Configure USB VID and PID');
  const helper = fileURLToPath(new URL('./msp_ready.py', import.meta.url));
  const { stdout } = await execute(usb.mspPython, ['-I', helper, expectedUid.toLowerCase(), String(usb.vid), String(usb.pid)],
    { windowsHide: true, timeout: 50000, signal });
  return JSON.parse(stdout);
}

async function run(executable, args) {
  if (!executable || !path.isAbsolute(executable)) throw Error('Configure an absolute executable path');
  const { stdout, stderr } = await execute(executable, args, { windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 });
  return stdout + stderr;
}

export async function debugTarget(config, action, command = run) {
  const { host, swd } = config;
  if (typeof host !== 'string' || !/^[a-zA-Z0-9.:-]+$/.test(host) || !/^target\/[a-zA-Z0-9_.-]+\.cfg$/.test(swd?.target))
    throw Error('Configure the SWD host and OpenOCD target');
  const operations = new Map([['read_cpuid', 'mdw 0xE000ED00 1'], ['halt', 'halt'], ['resume', 'resume']]);
  if (!operations.has(action)) throw Error('Unknown debugger action');
  const cfg = fileURLToPath(new URL('./wda-swd.cfg', import.meta.url));
  const output = await command(swd.executable, ['-c', 'set WDA_HOST ' + host, '-c', 'set TARGET_CFG ' + swd.target,
    '-c', 'gdb port disabled', '-c', 'tcl port disabled', '-c', 'telnet port disabled', '-f', cfg,
    '-c', 'init', '-c', operations.get(action), '-c', 'shutdown']);
  return { action, output };
}

async function importedPorts(executable, host, command) {
  const output = await command(executable, ['port']);
  if (output.trim() && !/^Imported USB devices/m.test(output)) throw Error('Unrecognized USB/IP port output');
  const prefix = 'usbip://' + host + ':3240/';
  const ports = new Map();
  for (const block of output.split(/(?=^Port\s+\d+:)/m)) {
    const port = block.match(/^Port\s+(\d+):/)?.[1];
    const endpoint = block.match(/^\s*->\s+(usbip:\/\/\S+)\s*$/m)?.[1];
    if (port && endpoint?.startsWith(prefix)) ports.set(endpoint.slice(prefix.length), port);
  }
  return ports;
}

async function importPort(executable, host, busid, command) {
  if (typeof busid !== 'string' || !/^[\w.-]+$/.test(busid) || busid.startsWith('-')) throw Error('Invalid USB busid');
  const attached = await command(executable, ['attach', '--once', '-r', host, '-b', busid]);
  const assigned = attached.match(/successfully attached to port\s+(\d+)/i);
  if (!assigned) throw Error('Import result unclear; inspect usbip port before retrying');
  return assigned[1];
}

export async function syncUsbImports(host, executable, command = run, discover = listDevices) {
  const ports = await importedPorts(executable, host, command);
  // The WDA export list omits devices in use. Windows owns their live imports.
  for (const { busid } of await discover(host)) {
    if (!ports.has(busid)) ports.set(busid, await importPort(executable, host, busid, command));
  }
  return Array.from(ports, ([busid, port]) => ({ busid, port: Number(port) }));
}

export async function controlUsb(config, action, command = run, discover = listDevices) {
  const { host, usb } = config;
  if (!usb || !/^[\w.-]+$/.test(usb.busid) || !Number.isInteger(usb.vid) || !Number.isInteger(usb.pid))
    throw Error('Configure USB busid, VID and PID');
  const port = (await importedPorts(usb.executable, host, command)).get(usb.busid);
  if (action === 'detach') {
    if (port) await command(usb.executable, ['detach', '-p', port]);
    return { attached: false };
  }
  if (action !== 'attach') throw Error('Unknown USB action');
  if (port) return { attached: true, port, reused: true };
  const devices = await discover(host);
  if (!devices.some(d => d.busid === usb.busid && d.vid === usb.vid && d.pid === usb.pid))
    throw Error('Configured USB device not found or VID/PID changed');
  return { attached: true, port: await importPort(usb.executable, host, usb.busid, command), reused: false };
}
