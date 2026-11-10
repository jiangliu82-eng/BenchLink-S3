import assert from 'node:assert/strict';
import { controlUsb, debugTarget } from '../host/channel-control.mjs';

const config = { host: '192.0.2.10', swd: { target: 'target/stm32f4x.cfg', executable: 'openocd' },
  usb: { busid: '1-2', vid: 123, pid: 456, executable: 'usbip' } };
let imported = false;
let attaches = 0;
const command = async (exe, args) => {
  assert.equal(exe, 'usbip');
  switch (args[0]) {
  case 'port':
    return 'Imported USB devices\r\nPort 01: in use\r\n -> usbip://192.0.2.10:3240/1-21\r\n' +
      (imported ? 'Port 07: in use\r\n -> usbip://192.0.2.10:3240/1-2\r\n' : '');
  case 'attach':
    assert.deepEqual(args, ['attach', '--once', '-r', config.host, '-b', '1-2']);
    imported = true; attaches++; return 'successfully attached to port 07';
  case 'detach':
    assert.deepEqual(args, ['detach', '-p', '07']); imported = false; return '';
  default: assert.fail('Unexpected command');
  }
};
const devices = async () => [config.usb];
await assert.rejects(controlUsb(config, 'attach', command, async () => []), /not found/);
for (let i=0; i<2; i++) assert.deepEqual(await controlUsb(config, 'attach', command, devices), {attached:true, port:'07'});
assert.equal(attaches, 1);
for (let i=0; i<2; i++) assert.deepEqual(await controlUsb(config, 'detach', command, devices), {attached:false});
for (const [action, expected] of [['read_cpuid','mdw 0xE000ED00 1'],['halt','halt'],['resume','resume']]) {
  const result = await debugTarget(config, action, async (exe, args) => {
    assert.equal(exe, 'openocd'); assert.deepEqual(args.slice(-4), ['-c', expected, '-c', 'shutdown']); return 'ok';
  });
  assert.equal(result.output, 'ok');
}
await assert.rejects(debugTarget(config, 'arbitrary'), /Unknown/);
console.log('PASS: USB attach/detach ownership, VID/PID guard, debugger command allowlist');
