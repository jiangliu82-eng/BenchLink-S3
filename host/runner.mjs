import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { listDevices } from './probe.mjs';

export class TestRunner {
  constructor(config, reportDirectory, onEvent = () => {}, transport = {}) {
    this.config = config;
    this.directory = reportDirectory;
    this.onEvent = onEvent;
    this.listDevices = transport.listDevices ?? listDevices;
    this.cycleUsb = transport.cycleUsb ?? (async (host, signal) => {
      const response = await fetch('http://' + host + '/api/test/usb-cycle', { method: 'POST', signal });
      if (!response.ok || !(await response.json()).rootPortRestarted) throw new Error('WDA root-port restart failed');
    });
    this.active = null;
  }
  status() { return this.active && { id: this.active.id, mode: this.active.mode, started: this.active.started }; }
  cancel() { this.active?.controller.abort(); }
  async run(mode, { scripted = false } = {}) {
    if (this.active) throw new Error('Another test owns this WDA');
    if (!['usb', 'swd', 'concurrent'].includes(mode)) throw new Error('Unknown test mode');
    const run = { id: randomUUID(), mode, started: new Date().toISOString(),
      controller: new AbortController(), events: [], status: 'running' };
    this.active = run;
    let importedPort;
    let importedBusid;
    const log = (channel, action, detail) => {
      const event = { time: new Date().toISOString(), elapsedMs: performance.now() - begin,
        channel, action, detail };
      run.events.push(event);
      this.onEvent(event);
    };
    const begin = performance.now();
    const command = async (channel, executable, args, timeoutMs = 30000, cancelable = true) => {
      if (!path.isAbsolute(executable)) throw new Error('Executable must be an absolute path');
      if (cancelable) run.controller.signal.throwIfAborted();
      log(channel, 'command-start', { executable, args });
      const output = await new Promise((resolve, reject) => {
        const child = spawn(executable, args, { windowsHide: true, shell: false,
          signal: cancelable ? run.controller.signal : undefined });
        let stdout = '', stderr = '', expired = false, oversized = false, processError;
        const pending = ['', ''];
        const timer = setTimeout(() => { expired = true; child.kill(); }, timeoutMs);
        const append = (chunk, isError) => {
          if (isError) stderr += chunk; else stdout += chunk;
          const stream = Number(isError);
          pending[stream] += chunk;
          const lines = pending[stream].split(/\r?\n/);
          pending[stream] = lines.pop();
          for (const line of lines) {
            if (line.includes('WDA_SWD_SAMPLE')) log('SWD', 'sample', line);
          }
          if (stdout.length + stderr.length > 2 * 1024 * 1024) { oversized = true; child.kill(); }
        };
        child.stdout.on('data', chunk => append(chunk, false));
        child.stderr.on('data', chunk => append(chunk, true));
        child.once('error', error => { processError = error; });
        child.once('close', (code, signal) => {
          clearTimeout(timer);
          log(channel, 'command-end', { code, signal, stdout, stderr, expired, oversized });
          if (processError) return reject(processError);
          if (code !== 0 || expired || oversized) return reject(new Error(
            channel + ' command failed: ' + (expired ? 'timeout' : oversized ? 'output limit' : code)));
          resolve(stdout + stderr);
        });
      });
      return output;
    };
    const cfg = this.config;
    const attach = async (afterRestart = false) => {
      let selected;
      const deadline = performance.now() + 15000;
      do {
        run.controller.signal.throwIfAborted();
        const devices = await this.listDevices(cfg.host);
        const matches = devices.filter(d => d.vid === cfg.usb.vid && d.pid === cfg.usb.pid);
        if (afterRestart && matches.length > 1) throw new Error('Ambiguous device after restart');
        selected = afterRestart ? matches[0] : devices.find(d => d.busid === cfg.usb.busid);
        if (selected || !afterRestart) break;
        await new Promise(resolve => setTimeout(resolve, 300));
      } while (performance.now() < deadline);
      if (!selected) throw new Error('Configured USB busid is not exported');
      if (selected.vid !== cfg.usb.vid || selected.pid !== cfg.usb.pid)
        throw new Error('USB VID/PID changed; review the selected device');
      const verifyArgs = ['-NoProfile', '-File',
        fileURLToPath(new URL('./verify-usb.ps1', import.meta.url)),
        '-Vid', cfg.usb.vid.toString(16).padStart(4, '0'),
        '-Pid', cfg.usb.pid.toString(16).padStart(4, '0')];
      const before = JSON.parse(await command('USB', cfg.powershell, [...verifyArgs, '-Snapshot']));
      let output;
      try {
        run.controller.signal.throwIfAborted();
        output = await command('USB', cfg.usb.executable,
          ['attach', '--once', '-r', cfg.host, '-b', selected.busid], 30000, false);
      } catch (error) {
        const ended = run.events.findLast(e => e.channel === 'USB' && e.action === 'command-end');
        const partial = (ended?.detail.stdout ?? '') + (ended?.detail.stderr ?? '');
        const attached = partial.match(/successfully attached to port\s+(\d+)/i);
        if (attached) { importedPort = attached[1]; importedBusid = selected.busid; }
        else log('USB', 'import-status-unknown', { host: cfg.host, busid: selected.busid });
        throw error;
      }
      const match = output.match(/successfully attached to port\s+(\d+)/i);
      if (!match) throw new Error('USB import result is ambiguous; inspect usbip port before retry');
      importedPort = match[1];
      importedBusid = selected.busid;
      log('USB', 'imported', { port: importedPort, device: selected });
      await command('USB', cfg.powershell, [...verifyArgs, '-ExcludeJson', JSON.stringify(before)]);
    };
    const ownedPortPresent = async () => {
      const output = await command('USB', cfg.usb.executable, ['port'], 10000, false);
      if (!output.trim()) return false;
      const blocks = output.split(/(?=^Port\s+\d+:)/m);
      const block = blocks.find(text => Number(text.match(/^Port\s+(\d+):/)?.[1]) === Number(importedPort));
      if (!block) {
        if (!/^Imported USB devices/m.test(output)) throw new Error('Unrecognized USB/IP port output');
        return false;
      }
      if (!block.includes('usbip://' + cfg.host + ':3240/' + importedBusid + '\n') &&
          !block.includes('usbip://' + cfg.host + ':3240/' + importedBusid + '\r'))
        throw new Error('USB port ownership changed; cleanup stopped');
      return true;
    };
    const detach = async () => {
      if (importedPort === undefined) return;
      if (await ownedPortPresent()) {
        try { await command('USB', cfg.usb.executable, ['detach', '-p', importedPort], 10000, false); }
        catch (error) { if (await ownedPortPresent()) throw error; }
      }
      log('USB', 'detached', { port: importedPort });
      importedPort = undefined;
    };
    const workload = async () => {
      const job = cfg.usb.workload;
      if (!job?.expectedText) throw new Error('USB workload must provide expectedText');
      const output = await command('USB', job.executable, job.args, job.timeoutMs ?? 30000);
      if (!output.includes(job.expectedText)) throw new Error('USB workload did not return expected success evidence');
      log('USB', 'traffic-verified', { expectedText: job.expectedText });
    };
    const usb = async () => {
      await attach();
      await workload();
      log('USB', 'root-restart-start', {});
      await this.cycleUsb(cfg.host, AbortSignal.any([run.controller.signal, AbortSignal.timeout(10000)]));
      log('USB', 'root-restarted', {});
      await detach();
      await attach(true);
      await workload();
      log('USB', 'reenumeration-verified', {});
    };
    const swd = async () => {
      const target = cfg.swd.target;
      if (!/^target\/[a-zA-Z0-9_.-]+\.cfg$/.test(target)) throw new Error('Invalid target configuration');
      if (!/^[a-zA-Z0-9.:-]+$/.test(cfg.host)) throw new Error('Invalid WDA host');
      if (!/^0x[0-9a-fA-F]{1,8}$/.test(cfg.swd.scratchAddress) || Number(cfg.swd.scratchAddress) % 4 !== 0)
        throw new Error('Set a dedicated writable RAM scratchAddress on the selected target');
      const iterations = cfg.swd.iterations ?? 30;
      if (!Number.isInteger(iterations) || iterations < 1 || iterations > 600) throw new Error('Invalid iterations');
      run.controller.signal.throwIfAborted();
      const output = await command('SWD', cfg.swd.executable,
        ['-c', 'set WDA_HOST ' + cfg.host, '-c', 'set TARGET_CFG ' + target,
          '-c', 'set WDA_SCRATCH ' + cfg.swd.scratchAddress,
          '-c', 'set WDA_ITERATIONS ' + iterations, '-c', 'set WDA_SCRIPTED ' + Number(scripted),
          '-f', fileURLToPath(new URL('./wda-swd.cfg', import.meta.url)),
          '-f', fileURLToPath(new URL('./swd-test.tcl', import.meta.url))],
        iterations * 1000 + 30000, !scripted);
      if (!output.includes('WDA_SWD_PASS')) throw new Error('OpenOCD completed without SWD pass evidence');
      log('SWD', 'verified', {});
    };
    try {
      await fs.mkdir(this.directory, { recursive: true });
      if (mode === 'usb') await usb();
      else if (mode === 'swd') await swd();
      else {
        const jobs = [usb(), swd()].map(job => job.catch(error => {
          run.controller.abort(); throw error;
        }));
        const results = await Promise.allSettled(jobs);
        const failure = results.find(r => r.status === 'rejected');
        if (failure) throw failure.reason;
        const samples = run.events.filter(e => e.channel === 'SWD' && e.action === 'sample');
        const usbStart = run.events.find(e => e.action === 'imported');
        const usbEnd = run.events.find(e => e.action === 'reenumeration-verified');
        if (!samples.some(e => e.elapsedMs >= usbStart.elapsedMs && e.elapsedMs <= usbEnd.elapsedMs) ||
            !samples.some(e => e.elapsedMs > usbEnd.elapsedMs))
          throw new Error('SWD loop ended before USB reimport; increase SWD iterations');
      }
      run.controller.signal.throwIfAborted();
      run.status = 'passed';
    } catch (error) {
      run.status = 'failed'; run.error = error.message;
    } finally {
      try { await detach(); } catch (error) {
        run.status = 'failed'; run.cleanupError = error.message;
      }
      run.finished = new Date().toISOString();
      const report = { ...run, controller: undefined };
      try {
        const filename = path.join(this.directory, run.id + '.json');
        await fs.writeFile(filename, JSON.stringify(report, null, 2), { flag: 'wx' });
        run.report = filename;
      } finally { this.active = null; }
    }
    return { id: run.id, status: run.status, error: run.error,
      cleanupError: run.cleanupError, report: run.report };
  }
}
