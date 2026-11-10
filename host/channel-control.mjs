import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDevices } from './probe.mjs';

const execute = promisify(execFile);

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

export async function controlUsb(config, action, command = run, discover = listDevices) {
  const { host, usb } = config;
  if (!usb || !/^[\w.-]+$/.test(usb.busid) || !Number.isInteger(usb.vid) || !Number.isInteger(usb.pid))
    throw Error('Configure USB busid, VID and PID');
  const output = await command(usb.executable, ['port']);
  if (output.trim() && !/^Imported USB devices/m.test(output)) throw Error('Unrecognized USB/IP port output');
  const endpoint = 'usbip://' + host + ':3240/' + usb.busid;
  const block = output.split(/(?=^Port\s+\d+:)/m).find(text =>
    text.split(/\r?\n/).some(line => line.trim().split(/\s+/).at(-1) === endpoint));
  const port = block?.match(/^Port\s+(\d+):/)?.[1];
  if (action === 'detach') {
    if (port) await command(usb.executable, ['detach', '-p', port]);
    return { attached: false };
  }
  if (action !== 'attach') throw Error('Unknown USB action');
  if (port) return { attached: true, port };
  const devices = await discover(host);
  if (!devices.some(d => d.busid === usb.busid && d.vid === usb.vid && d.pid === usb.pid))
    throw Error('Configured USB device not found or VID/PID changed');
  const attached = await command(usb.executable, ['attach', '--once', '-r', host, '-b', usb.busid]);
  const assigned = attached.match(/successfully attached to port\s+(\d+)/i);
  if (!assigned) throw Error('Import result unclear; inspect usbip port before retrying');
  return { attached: true, port: assigned[1] };
}
