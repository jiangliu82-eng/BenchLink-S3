import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PairingManager, authenticate, mac, windowsOperation } from '../host/pairing.mjs';

const directory=await fs.mkdtemp(path.join(os.tmpdir(),'wda-pair-test-'));
const deviceId='wda-102030405060';let deviceKey=null, failure=null, online=true, actualHost='192.168.1.22';
let serialCalls=0;
const operation=async(action,data)=>{
  if(action==='ports')return ['COM8'];
  if(action==='protect')return {value:'test-sealed:'+Buffer.from(data.value).toString('base64')};
  if(action==='unprotect')return {value:Buffer.from(data.value.slice(12),'base64').toString()};
  serialCalls++;const r=data.request;
  const base={requestId:r.requestId,version:1,deviceId,host:actualHost,paired:Boolean(deviceKey),ok:true};
  if(r.command==='identify')return base;
  assert.equal(r.deviceId,deviceId);
  if(failure==='wifi')return {...base,ok:false,error:'wifi_failed'};
  // The durable recovery key must exist even if the serial reply is lost.
  const disk=await fs.readFile(path.join(directory,'devices.json'),'utf8');
  assert(!disk.includes(r.password));assert(!disk.includes(r.key));assert(disk.includes('test-sealed:'));
  deviceKey=r.key;
  if(failure==='lost')throw Error('serial lost');
  return base;
};
const verify=async(host,binding)=>{if(!online||host!==actualHost||binding.key!==deviceKey)throw Error('unreachable or invalid');return host;};
let discovered=0;const find=async()=>{discovered++;return [actualHost];};
const manager=new PairingManager(directory,{operation,verify,find});await manager.init();
const input={port:'COM8',deviceId,name:'工作台一号',ssid:'测试局域网',password:'wifi-secret-test'};
try {
  assert.equal((await manager.identify('COM8')).deviceId,deviceId);
  await assert.rejects(manager.identify('COM8; bad'),/COM/);
  await assert.rejects(manager.pair({...input,password:'short'}),/Wi-Fi/);
  const paired=await manager.pair(input);assert(paired.online);assert.equal(paired.activeId,deviceId);
  assert(!JSON.stringify(paired).includes(deviceKey));assert(!JSON.stringify(paired).includes('sealed'));
  await assert.rejects(manager.pair(input),/已有绑定/);
  const oldKey=deviceKey;failure='wifi';await assert.rejects(manager.pair({...input,replace:true}),/Wi-Fi/);assert.equal(deviceKey,oldKey);
  assert(await manager.reconnect());
  failure='lost';await assert.rejects(manager.pair({...input,replace:true}),/serial lost/);
  assert(manager.devices[0].pending);assert.notEqual(deviceKey,oldKey);
  failure=null;actualHost='192.168.1.39';assert.equal(await manager.reconnect(),actualHost);assert(discovered>0);assert(!manager.devices[0].pending);
  const restarted=new PairingManager(directory,{operation,verify,find});await restarted.init();assert.equal(await restarted.reconnect(),actualHost);
  online=false;const pending=await restarted.pair({...input,replace:true});assert(!pending.online);assert(pending.devices[0].pending);
  online=true;assert(await restarted.reconnect());
  const blocked=restarted.exclusive(()=>new Promise(r=>setTimeout(r,40)));await assert.rejects(restarted.identify('COM8'),/另一项/);await blocked;
  const challenge='a'.repeat(32);let nonce;
  const fetcher=async(url,options)=>{
    if(options.method==='POST'){
      const body=JSON.parse(options.body);assert.equal(body.proof,mac(deviceKey,`client\n${deviceId}\n${challenge}`));
      return {ok:true,json:async()=>({proof:mac(deviceKey,`ready\n${deviceId}\n${challenge}`)})};
    }
    nonce=new URL(url).searchParams.get('nonce');return {ok:true,json:async()=>({deviceId,challenge,proof:mac(deviceKey,`device\n${deviceId}\n${nonce}\n${challenge}`)})};
  };
  assert.equal(await authenticate(actualHost,{deviceId,key:deviceKey},fetcher),actualHost);
  await assert.rejects(authenticate(actualHost,{deviceId,key:deviceKey},async()=>({ok:true,json:async()=>({deviceId,challenge,proof:'0'.repeat(64)})})),/身份/);
  await assert.rejects(authenticate('evil.invalid',{deviceId,key:deviceKey},fetcher),/地址/);
  if(process.platform==='win32'){
    const sealed=await windowsOperation('protect',{value:'ephemeral-test-only'});
    assert.notEqual(sealed.value,'ephemeral-test-only');
    assert.equal((await windowsOperation('unprotect',sealed)).value,'ephemeral-test-only');
    assert(Array.isArray(await windowsOperation('ports')));
  }
  console.log('PASS: pairing, encrypted persistence, wrong Wi-Fi rollback, replacement consent, lost serial reply recovery, IP rediscovery, restart, LAN verification failure, mutual proof, operation exclusion, Windows DPAPI/port enumeration');
}finally{await fs.rm(directory,{recursive:true,force:true});}
