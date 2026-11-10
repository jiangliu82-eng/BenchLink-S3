import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { TestRunner } from './runner.mjs';
import { PairingManager } from './pairing.mjs';
const [configFile, mode, output = 'reports'] = process.argv.slice(2);
if (!configFile || !mode) throw new Error('Usage: node run-test.mjs <config.json> <usb|swd|concurrent> [reports]');
const config = JSON.parse(await fs.readFile(configFile, 'utf8'));
const pairing = new PairingManager(process.env.WDA_DEVICE_STORE ?? path.join(process.env.LOCALAPPDATA ?? os.homedir(), 'WDA-Studio'));
await pairing.init();
if(!pairing.activeId)throw Error('请先在工作台完成 USB 配网和绑定');
config.host=await pairing.reconnect();
if(!config.host)throw Error('已绑定设备离线');
const runner = new TestRunner(config, path.resolve(output), event => console.log(JSON.stringify(event)));
process.on('SIGINT', () => runner.cancel());
const heartbeat=setInterval(async()=>{if(pairing.busy)return;try{if(!await pairing.reconnect())runner.cancel();}catch{runner.cancel();}},30000);
try{
  const result = await runner.run(mode);
  console.log(JSON.stringify(result));
  if (result.status !== 'passed') process.exitCode = 1;
}finally{clearInterval(heartbeat);}
