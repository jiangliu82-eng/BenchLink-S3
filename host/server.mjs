import { debugTarget, controlUsb } from './channel-control.mjs';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { TestRunner } from './runner.mjs';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { listDevices, probeDap } from './probe.mjs';
import { PairingManager } from './pairing.mjs';

const config = process.env.WDA_CONFIG ? JSON.parse(await fs.readFile(process.env.WDA_CONFIG, 'utf8')) : null;
let hostname = config?.host ?? process.env.WDA_HOST;
const pairing = new PairingManager(process.env.WDA_DEVICE_STORE ?? path.join(process.env.LOCALAPPDATA ?? os.homedir(), 'WDA-Studio'));
await pairing.init();
const bind = process.env.WDA_BIND ?? '127.0.0.1';
const port = Number(process.env.WDA_PORT ?? 7210);
const token = process.env.WDA_TOKEN;
if (bind !== '127.0.0.1' && (!token || token.length < 24))
  throw new Error('Set a WDA_TOKEN of at least 24 characters before LAN binding');
const events = [];
function record(channel, ok, detail) {
  const event = { time: new Date().toISOString(), channel, ok, detail };
  events.push(event);
  if (events.length > 1000) events.shift();
  return event;
}
let probing = false;
let backgroundCheck = null;
let usbReconnectDevice = null;
let usbReconnectError = null;
async function probe(mode) {
  if (backgroundCheck) await backgroundCheck;
  if (closing) throw Error('Service is shutting down');
  if (pairing.busy || probing || runner?.status()) throw new Error('The active operation owns the connection');
  probing = true;
  try {
    if(pairing.activeId && !await reconnect()) throw Error('设备离线，请重新连接 / Device offline. Reconnect.');
    if (!hostname) throw new Error('请先添加设备 / Add a device first.');
    const channels = mode === 'usb' ? [['USB/IP', listDevices]] :
      mode === 'swd' ? [['CMSIS-DAP', probeDap]] : [['USB/IP', listDevices], ['CMSIS-DAP', probeDap]];
    const results = await Promise.allSettled(channels.map(([, query]) => query(hostname)));
    return results.map((r, index) => record(channels[index][0],
      r.status === 'fulfilled', r.value ?? String(r.reason.message)));
  } finally { probing = false; }
}
let latestResult = null;
let activePromise = null;
let closing = false;
const reportsDir = path.resolve(process.env.WDA_REPORTS ?? 'reports');
async function readReport(id) {
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) throw new Error('Invalid report ID');
  return JSON.parse(await fs.readFile(path.join(reportsDir, id + '.json'), 'utf8'));
}
const runner = config ? new TestRunner(config, reportsDir, event => {
  events.push(event); if (events.length > 1000) events.shift();
}) : null;
function state() {
  const status = pairing.status();
  status.checking = Boolean(backgroundCheck);
  if (status.checking) status.busy = false;
  return { host: hostname ?? null, configured: Boolean(config), pairing: status, probing, running: runner?.status(), latestResult, events,
    usbReconnect: { deviceId: usbReconnectDevice, error: usbReconnectError } };
}
async function reconnect(id) {
  const host=await pairing.reconnect(id);
  if(host&&!runner?.status()){hostname=host;if(config)config.host=host;}
  return host;
}
async function startTest(mode, automated = false) {
  if (backgroundCheck) await backgroundCheck;
  if (closing) throw Error('Service is shutting down');
  if (pairing.busy || probing) throw new Error('Connection operation is still running');
  if (!runner) throw new Error('Set WDA_CONFIG to a reviewed test configuration');
  if (!['usb', 'swd', 'concurrent'].includes(mode)) throw new Error('Invalid mode');
  if (runner.status()) throw new Error('A test is already running');
  probing=true;
  try {if(pairing.activeId && !await reconnect())throw Error('设备离线，请重新连接 / Device offline. Reconnect.');}
  finally {probing=false;}
  if (closing) throw Error('Service is shutting down');
  events.length = 0;
  latestResult = null;
  activePromise = runner.run(mode, { scripted: automated }).then(result => { latestResult = result; return result; }).catch(error => { latestResult = { status: 'failed', error: error.message }; });
  return runner.status();
}
function cancelTest() {
  runner?.cancel();
  return { cancellationRequested: true };
}
function tool(name, description, properties = {}, required = []) {
  return { name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false } };
}
const channels = new Map([['wda_debugger', 'swd'], ['wda_usb_passthrough', 'usb']]);
const tools = Array.from(channels, ([name, mode]) => tool(name, mode === 'swd'
  ? 'Read CPUID, halt or resume the target, probe CMSIS-DAP or run the configured OpenOCD SWD test (halts target and writes reserved RAM). 读取 CPUID、暂停或恢复目标、探测 CMSIS-DAP，或运行配置的 OpenOCD SWD 测试（会暂停目标并写入专用 RAM）。'
  : 'Attach/detach the configured USB/IP device, list devices or run the configured attach, workload, re-enumeration and detach test. 挂载或释放配置的 USB/IP 设备、列出设备，或测试挂载、实际负载、重新枚举和释放。', {
  action: { type: 'string', enum: ['probe', 'start', 'status', 'cancel', 'report', ...(mode === 'usb' ? ['attach', 'detach'] : ['read_cpuid', 'halt', 'resume'])] },
  ...(mode === 'usb' ? { autoReconnect: { type: 'boolean', description: 'For attach only. Re-import the configured device after re-enumeration while this host service runs. 仅用于 attach，主机服务运行时在设备重新枚举后自动重新挂载。' } } : {}),
  id: { type: 'string', description: 'Run ID required for status, cancel and report. 查询状态、取消或读取报告时需提供本次运行的 ID。' }
}, ['action']));

async function channelAction(mode, args) {
  if (args.autoReconnect !== undefined && (mode !== 'usb' || args.action !== 'attach' || typeof args.autoReconnect !== 'boolean'))
    throw Error('autoReconnect requires USB attach and a boolean value');
  const direct = mode === 'usb' ? ['attach', 'detach'] : ['read_cpuid', 'halt', 'resume'];
  if (direct.includes(args.action)) {
    if (args.id !== undefined) throw Error('Unexpected run ID');
    if (backgroundCheck) await backgroundCheck;
    if (closing || pairing.busy || probing || runner?.status()) throw Error('Device is busy');
    if (!config) throw Error('Load a local target configuration first');
    probing = true;
    try {
      if (mode === 'usb' && (args.action === 'detach' || args.autoReconnect === false)) {
        usbReconnectDevice = null;
        usbReconnectError = null;
      }
      if (args.autoReconnect && !pairing.activeId) throw Error('Pair the device before enabling USB auto-reconnect');
      if (pairing.activeId && !await reconnect()) throw Error('Device offline');
      if (!hostname) throw Error('Configure or pair a device first');
      const active = { ...config, host: hostname };
      if (mode === 'swd') return await debugTarget(active, args.action);
      const result = await controlUsb(active, args.action);
      if (args.autoReconnect) {
        usbReconnectDevice = pairing.activeId;
        usbReconnectError = null;
        return { ...result, autoReconnect: true };
      }
      return result;
    } finally { probing = false; }
  }
  if (args.action === 'probe' || args.action === 'start') {
    if (args.id !== undefined) throw Error('Unexpected run ID');
    if (args.action === 'start') return startTest(mode, true);
    const [result] = await probe(mode);
    if (!result.ok) throw Error(result.detail);
    return result.detail;
  }
  if (!['status', 'cancel', 'report'].includes(args.action)) throw Error('Unknown action');
  const running = runner?.status();
  if (running && running.id === args.id && running.mode === mode) {
    if (args.action === 'cancel') return cancelTest();
    if (args.action === 'status') return { ...running, status: 'running' };
    throw Error('Report available after completion');
  }
  if (args.action === 'cancel') throw Error('No matching active run');
  const report = await readReport(args.id);
  if (report.mode !== mode) throw Error('Report belongs to a different channel');
  return args.action === 'report' ? report : { id: report.id, mode, status: report.status, error: report.error, cleanupError: report.cleanupError };
}
async function rpc(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string')
    return { jsonrpc: '2.0', id: message?.id ?? null, error: { code: -32600, message: 'Invalid request' } };
  if (message.id === undefined) return;
  const reply = { jsonrpc: '2.0', id: message.id };
  switch (message.method) {
  case 'initialize':
    return { ...reply, result: { protocolVersion: '2025-03-26', capabilities: { tools: {} },
      serverInfo: { name: 'BenchLink-S3', version: '0.1.1' } } };
  case 'ping': return { ...reply, result: {} };
  case 'tools/list': return { ...reply, result: { tools } };
  case 'tools/call':
    try {
      const name = message.params?.name;
      const entry = tools.find(t => t.name === name);
      if (!entry) throw new Error('Unknown tool');
      const args = message.params?.arguments ?? {};
      const allowed = Object.keys(entry.inputSchema.properties);
      if (typeof args !== 'object' || Array.isArray(args) || entry.inputSchema.required?.some(k => !Object.hasOwn(args,k)) || Object.keys(args).some(key => !allowed.includes(key))) throw new Error('Unexpected arguments');
      const result = await channelAction(channels.get(name), args);
      return { ...reply, result: { content: [{ type: 'text', text: JSON.stringify(result) }] } };
    } catch (error) {
      return { ...reply, result: { isError: true, content: [{ type: 'text', text: error.message }] } };
    }
  default: return { ...reply, error: { code: -32601, message: 'Method not found' } };
  }
}
function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
const allowedHosts = new Set([bind, '127.0.0.1', 'localhost', os.hostname().toLowerCase(),
  ...Object.values(os.networkInterfaces()).flat().filter(Boolean).map(item => item.address)]);
const server = http.createServer(async (req, res) => {
  try {
    const requestHost = new URL('http://' + req.headers.host);
    if (!allowedHosts.has(requestHost.hostname.toLowerCase())) return json(res, 403, {error: 'Host rejected'});
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path === '/' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'" });
      return res.end(await fs.readFile(fileURLToPath(new URL('./index.html', import.meta.url))));
    }
    if (token && req.headers.authorization !== 'Bearer ' + token)
      return json(res, 401, { error: 'Authorization required' });
    if (req.headers.origin) {
      const origin = new URL(req.headers.origin);
      if (origin.host !== req.headers.host) return json(res, 403, { error: 'Origin rejected' });
    }
    if (path === '/api/status' && req.method === 'GET') return json(res, 200, state());
    if (path.startsWith('/api/pairing/')) {
      // Physical provisioning is local UI only; never available through the LAN Agent.
      if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress))return json(res,403,{error:'请在设备所连接的电脑上打开本地工作台配对 / Open the local workbench on the PC connected to the device to pair.'});
      if(runner?.status()||probing||closing) return json(res,409,{error:'请等待当前测试或探测完成 / Wait for the current test or probe to finish.'});
      if(path==='/api/pairing/ports' && req.method==='GET')return json(res,200,await pairing.ports());
      if(req.method!=='POST')return json(res,405,{error:'Unsupported method'});
      let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>4096)return json(res,413,{error:'Request too large'});}
      if (backgroundCheck) await backgroundCheck;
      if(runner?.status() || probing || closing) return json(res,409,{error:'Device is busy'});
      let data;try{data=JSON.parse(body);}catch{return json(res,400,{error:'Invalid JSON'});}
      if(!data||typeof data!=='object'||Array.isArray(data))return json(res,400,{error:'Invalid request'});
      try {
        if(path==='/api/pairing/identify')return json(res,200,await pairing.identify(data.port));
        if(path==='/api/pairing/provision'){
          const result=await pairing.pair(data);
          if(result.online){hostname=result.devices.find(d=>d.deviceId===result.activeId).host;if(config)config.host=hostname;}
          return json(res,200,result);
        }
        if(path==='/api/pairing/reconnect'){await reconnect(data.deviceId);return json(res,200,pairing.status());}
      }catch(error){return json(res,400,{error:error.message});}
      return json(res,404,{error:'Unknown pairing route'});
    }
    if (path === '/api/probe' && req.method === 'POST') return json(res, 200, await probe());
    if (path === '/api/test/cancel' && req.method === 'POST') return json(res, 202, cancelTest());
    if (path.startsWith('/api/test/') && req.method === 'POST') return json(res, 202, await startTest(path.slice('/api/test/'.length)));
    if (path === '/mcp' && req.method === 'POST') {
      req.setEncoding('utf8');
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (Buffer.byteLength(body) > 65536) return json(res, 413, { error: 'Request too large' });
      }
      let message;
      try { message = JSON.parse(body); } catch { return json(res, 400, { error: 'Invalid JSON' }); }
      const result = await rpc(message);
      if (!result) { res.writeHead(202); return res.end(); }
      return json(res, 200, result);
    }
    return json(res, 405, { error: 'Unsupported route or method' });
  } catch (error) { json(res, 500, { error: error.message }); }
}).listen(port, bind, () => console.log('BenchLink-S3 listening', bind, server.address().port));

function maintainConnection(){
  if(closing||backgroundCheck||runner?.status()||pairing.busy||probing||!pairing.activeId)return;
  if (usbReconnectDevice && usbReconnectDevice !== pairing.activeId) {
    usbReconnectDevice = null;
    usbReconnectError = null;
  }
  backgroundCheck = reconnect().then(async host => {
    if (!host || closing || !usbReconnectDevice || usbReconnectDevice !== pairing.activeId) return;
    try {
      await controlUsb({ ...config, host }, 'attach');
      if (usbReconnectError) record('USB/IP', true, 'USB attachment restored');
      usbReconnectError = null;
    } catch (error) {
      if (usbReconnectError !== error.message) record('USB/IP', false, error.message);
      usbReconnectError = error.message;
    }
  }).catch(() => {
    pairing.online=false;
    pairing.error='无法恢复设备绑定，请在本机重新配对 / Cannot recover the binding. Pair again on this PC.';
  }).finally(() => { backgroundCheck=null; });
  return backgroundCheck;
}
const heartbeat=setInterval(maintainConnection,30000);
await maintainConnection();

async function shutdown() {
  if (closing) return;
  closing = true;
  clearInterval(heartbeat);
  runner?.cancel();
  await activePromise;
  await backgroundCheck;
  server.close();
  server.closeAllConnections();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
