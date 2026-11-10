// Windows orchestration integration test. FakeTool replaces hardware tools;
// the real runner, child processes, TCP framing, HTTP cycle and report files run.
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { TestRunner } from '../host/runner.mjs';
import { probeDap, listDevices } from '../host/probe.mjs';
const fake = path.resolve(process.argv[2]);
let restarts = 0;
const usb = net.createServer(socket => {
  let request = Buffer.alloc(0);
  socket.on('data', chunk => {
    request = Buffer.concat([request, chunk]);
    if (request.length < 8) return;
    const data = Buffer.alloc(324);
    data.writeUInt16BE(0x111); data.writeUInt16BE(5, 2); data.writeUInt32BE(1, 8);
    data.write(restarts ? '1-2' : '1-1', 268);
    data.writeUInt32BE(2, 308); data.writeUInt16BE(0x1234, 312); data.writeUInt16BE(0x5678, 314);
    socket.write(data.subarray(0, 10)); setTimeout(() => socket.end(data.subarray(10)), 10);
  });
});
const dap = net.createServer(socket => socket.once('data', () => {
  socket.write(Buffer.from('4441500003000200', 'hex'));
  setTimeout(() => socket.end(Buffer.from('000101', 'hex')), 10);
}));
const api = http.createServer(async (req, res) => {
  assert.equal(req.url, '/api/test/usb-cycle'); assert.equal(req.method, 'POST');
  restarts++; await fs.rm(fake+'.state',{force:true}); res.setHeader('Content-Type', 'application/json'); res.end('{"rootPortRestarted":true}');
});
await Promise.all([new Promise(r => usb.listen(0, '127.0.0.1', r)),
  new Promise(r => dap.listen(0, '127.0.0.1', r)), new Promise(r => api.listen(0, '127.0.0.1', r))]);
const transport = { listDevices: host => listDevices(host, usb.address().port), cycleUsb: async (host, signal) => {
  const response = await fetch('http://' + host + ':' + api.address().port + '/api/test/usb-cycle', {method:'POST',signal});
  assert((await response.json()).rootPortRestarted);
}};
const directory = path.resolve('test-reports');
const config = {host:'127.0.0.1', powershell:fake, usb:{executable:fake,busid:'1-1',vid:0x1234,pid:0x5678,
  workload:{executable:fake,args:['traffic'],expectedText:'MOCK_USB_TRAFFIC_PASS'}},
  swd:{executable:fake,target:'target/stm32f4x.cfg',scratchAddress:'0x20000000',iterations:30}};
try {
  assert.equal((await listDevices(config.host, usb.address().port))[0].vid, 0x1234);
  assert.equal((await probeDap(config.host, dap.address().port)).swd, true);
  for (const mode of ['usb','swd','concurrent']) {
    restarts=0;
    const runner = new TestRunner(config, directory, undefined, transport);
    const result = await runner.run(mode);
    assert.equal(result.status, 'passed', JSON.stringify(result));
    const report = JSON.parse(await fs.readFile(result.report, 'utf8'));
    assert.equal(report.mode,mode);
    if(mode !== 'swd') {
      assert.equal(restarts,1);
      assert(report.events.some(e=>e.action==='reenumeration-verified'));
      assert.equal(report.events.at(-1).action,'detached');
    }
  }
  restarts=0;
  const runner = new TestRunner(config,directory, undefined, transport);
  const pending=runner.run('concurrent');
  await assert.rejects(runner.run('swd'),/owns/);
  setTimeout(()=>runner.cancel(),200);
  assert.equal((await pending).status,'failed');
  // Cancel only after attach ownership is known, then verify the actual fake driver state.
  restarts=0;
  let imported;
  const ready = new Promise(resolve => { imported = resolve; });
  const cancellable = new TestRunner(config,directory,e => { if(e.action === 'imported') imported(); },transport);
  const owned = cancellable.run('usb');
  await Promise.race([ready, owned.then(()=>{throw Error('Did not import before cancellation');})]);
  cancellable.cancel();
  const cancelled = await owned;
  const cancelledReport = JSON.parse(await fs.readFile(cancelled.report,'utf8'));
  assert.equal(cancelledReport.events.at(-1).action,'detached');
  await assert.rejects(fs.access(fake+'.state'),{code:'ENOENT'});
  const invalid = new TestRunner({...config,swd:{...config.swd,scratchAddress:null}},directory);
  assert.equal((await invalid.run('swd')).status,'failed');
  console.log('PASS: fragmented probes, USB/SWD/concurrent orchestration, report persistence, ownership, cancellation, invalid scratch guard');
} finally {
  await Promise.all([new Promise(r=>usb.close(r)),new Promise(r=>dap.close(r)),new Promise(r=>api.close(r))]);
}
