import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const deviceStore=await fs.mkdtemp(path.join(os.tmpdir(),'wda-http-test-'));
const env = {...process.env,WDA_BIND:'127.0.0.1',WDA_PORT:'0',WDA_TOKEN:'test-only-token-with-more-than-24-characters'};
env.WDA_DEVICE_STORE=deviceStore;
env.WDA_REPORTS=path.join(deviceStore,'reports');
delete env.WDA_CONFIG;
const child=spawn(process.execPath,[fileURLToPath(new URL('../host/server.mjs',import.meta.url))],{env,windowsHide:true});
const address=await new Promise((resolve,reject)=>{
  let data='';
  const timer=setTimeout(()=>reject(Error('Server startup timeout')),10000);
  child.once('error',reject);
  child.once('exit',code=>{clearTimeout(timer);reject(Error('Server exited '+code));});
  child.stdout.on('data',chunk=>{
    data+=chunk;
    const match=data.match(/BenchLink-S3 listening 127.0.0.1 (\d+)/);
    if(match){clearTimeout(timer);resolve('http://127.0.0.1:'+match[1]);}
  });
});
const headers={'Authorization':'Bearer '+env.WDA_TOKEN,'Content-Type':'application/json'};
async function rpc(method,params={}){
  const response=await fetch(address+'/mcp',{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
  assert.equal(response.status,200);return response.json();
}
try {
  assert.equal((await fetch(address+'/api/status')).status,401);
  assert.equal((await fetch(address+'/api/status',{headers:{...headers,Origin:'http://foreign.invalid'}})).status,403);
  const init=await rpc('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'integration-test',version:'1'}});
  assert.equal(init.result.protocolVersion,'2025-03-26');
  assert.equal(init.result.serverInfo.name,'BenchLink-S3');
  const list=await rpc('tools/list');
  assert.deepEqual(list.result.tools.map(t=>t.name), ['wda_debugger','wda_usb_passthrough']);
  assert(list.result.tools[1].inputSchema.properties.action.enum.includes('wait_msp_uid'));
  for (const args of [{action:'wait_msp_uid'}, {action:'wait_msp_uid',expectedUid:'1234'},
    {action:'probe',expectedUid:'00112233445566778899aabb'}]) {
    const reply = await rpc('tools/call', {name:'wda_usb_passthrough',arguments:args});
    assert.equal(reply.result.isError, true);
    assert.match(reply.result.content[0].text, /expectedUid/);
  }
  for (const name of ['wda_debugger','wda_usb_passthrough']) {
    for (const args of [{action:'start'}, {action:'probe'}, {action:'report',id:'../config'}, {action:'shell'}]) {
      const reply=await rpc('tools/call',{name,arguments:args});
      assert.equal(reply.result.isError,true);
    }
  }
  const runId='00000000-0000-0000-0000-000000000001';
  await fs.mkdir(env.WDA_REPORTS,{recursive:true});
  await fs.writeFile(path.join(env.WDA_REPORTS, runId+'.json'),JSON.stringify({id:runId,mode:'usb',status:'passed'}));
  const getReport=name=>rpc('tools/call',{name,arguments:{action:'report',id:runId}});
  for (const args of [{action:'report',id:runId,autoReconnect:true}, {action:'attach',autoReconnect:'yes'}]) {
    const reply = await rpc('tools/call', {name:'wda_usb_passthrough',arguments:args});
    assert.equal(reply.result.isError, true);
    assert.match(reply.result.content[0].text, /autoReconnect/);
  }
  assert.equal(JSON.parse((await getReport('wda_usb_passthrough')).result.content[0].text).status,'passed');
  assert.equal((await getReport('wda_debugger')).result.isError,true);
  assert.equal((await rpc('tools/call',{name:'wda_script_start',arguments:{}})).result.isError,true);
  const notification=await fetch(address+'/mcp',{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})});
  assert.equal(notification.status,202);
  const malformed=await fetch(address+'/mcp',{method:'POST',headers,body:'null'});
  assert.equal((await malformed.json()).error.code,-32600);
  const page=await (await fetch(address+'/')).text();
  assert.match(page, /<title>BenchLink-S3 工作台 \/ Workbench<\/title>/);
  assert.match(page, /WDA-S3 设备列表/);
  assert.match(page, /双通道并发 \/ Concurrent USB and SWD/);
  const pairDenied=await fetch(address+'/api/pairing/identify',{method:'POST',headers:{...headers,Origin:'http://foreign.invalid'},body:'{"port":"COM8"}'});
  assert.equal(pairDenied.status,403);
  const invalidPair=await fetch(address+'/api/pairing/provision',{method:'POST',headers,body:'{}'});assert.equal(invalidPair.status,400);
  const state=await (await fetch(address+'/api/status',{headers})).json();assert.deepEqual(state.pairing.devices,[]);
  const noMcpPair=await rpc('tools/call',{name:'wda_pair',arguments:{}});assert(noMcpPair.result.isError);
  console.log('PASS: HTTP UI, MCP initialization/discovery/tools, bearer auth, origin checks, notifications, invalid input');
} finally {
  child.kill('SIGTERM');
  await new Promise(resolve=>child.once('exit',resolve));
  await fs.rm(deviceStore,{recursive:true,force:true});
}
