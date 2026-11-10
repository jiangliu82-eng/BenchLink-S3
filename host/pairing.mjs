import { spawn } from 'node:child_process';
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import dgram from 'node:dgram';
import { fileURLToPath } from 'node:url';

const hex = n => randomBytes(n).toString('hex');
export const mac = (key, text) => createHmac('sha256', Buffer.from(key, 'hex')).update(text).digest('hex');
const validId = id => typeof id === 'string' && /^wda-[0-9a-f]{12}$/.test(id);
const validIp = ip => typeof ip === 'string' && ip.split('.').length === 4 && ip.split('.').every(x => /^\d{1,3}$/.test(x) && +x <= 255) && ip !== '0.0.0.0';
const equal = (a,b) => typeof a === 'string' && /^[a-f0-9]{64}$/.test(a) && timingSafeEqual(Buffer.from(a),Buffer.from(b));
export function windowsOperation(action, data = {}) {
  if (process.platform !== 'win32') throw Error('USB 配网目前支持 Windows');
  return new Promise((resolve,reject) => {
    const child=spawn(path.join(process.env.SystemRoot ?? 'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('./windows-device.ps1',import.meta.url)),'-Action',action],
      {windowsHide:true,stdio:['pipe','pipe','pipe']});
    let output='', failed=false;
    const timer=setTimeout(()=>{failed=true;child.kill();},40000);
    child.stdout.on('data',chunk=>{output+=chunk;if(output.length>16384){failed=true;child.kill();}});
    child.stderr.resume();
    child.stdin.on('error',()=>{});
    child.once('error',()=>{failed=true;});
    child.once('close',code=>{clearTimeout(timer);if(code!==0||failed)return reject(Error('无法访问设备或保存绑定，请检查串口、固件和 Windows 用户权限'));
      try{resolve(JSON.parse(output.replace(/^\uFEFF/,'')));}catch{reject(Error('设备返回无效数据'));}});
    child.stdin.end(JSON.stringify(data));
  });
}
export async function authenticate(host, binding, fetcher=fetch) {
  if(!validIp(host))throw Error('设备地址无效');
  const nonce=hex(16), url='http://'+host+'/api/wda/session';
  const get=await fetcher(url+'?nonce='+nonce,{signal:AbortSignal.timeout(3500),redirect:'error'});
  if(!get.ok)throw Error('设备认证服务不可用');
  const info=await get.json();
  if(info.deviceId!==binding.deviceId || !/^[a-f0-9]{32}$/.test(info.challenge) ||
      !equal(info.proof,mac(binding.key,`device\n${info.deviceId}\n${nonce}\n${info.challenge}`)))throw Error('设备身份校验失败');
  const response=await fetcher(url,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({challenge:info.challenge,proof:mac(binding.key,`client\n${info.deviceId}\n${info.challenge}`)}),
    signal:AbortSignal.timeout(3500),redirect:'error'});
  if(!response.ok)throw Error('设备未授权此电脑');
  const result=await response.json();
  if(!equal(result.proof,mac(binding.key,`ready\n${info.deviceId}\n${info.challenge}`)))throw Error('设备确认校验失败');
  return host;
}
export async function discover(binding, timeoutMs=1800) {
  const nonce=hex(16), socket=dgram.createSocket('udp4');
  return new Promise(resolve=>{
    const addresses=new Set();let timer,settled=false;
    const finish=()=>{if(settled)return;settled=true;clearTimeout(timer);socket.close();resolve([...addresses]);};
    socket.on('error',finish);
    socket.on('message',(buffer,remote)=>{try{const msg=JSON.parse(buffer);
      if(msg.deviceId===binding.deviceId && msg.nonce===nonce && validIp(remote.address) &&
        equal(msg.proof,mac(binding.key,`discover\n${binding.deviceId}\n${nonce}`)))addresses.add(remote.address);
    }catch{}});
    socket.bind(0,'0.0.0.0',()=>{
      socket.setBroadcast(true);
      const destinations=new Set(['255.255.255.255']);
      for(const item of Object.values(os.networkInterfaces()).flat().filter(Boolean))if(item.family==='IPv4'&&!item.internal){
        const ip=item.address.split('.').map(Number),mask=item.netmask.split('.').map(Number);
        destinations.add(ip.map((v,i)=>v|(~mask[i]&255)).join('.'));
      }
      for(const address of destinations)socket.send(JSON.stringify({type:'wda-discover',deviceId:binding.deviceId,nonce}),7211,address,()=>{});
      timer=setTimeout(finish,timeoutMs);
    });
  });
}
export class PairingManager {
  constructor(directory,{operation=windowsOperation,verify=authenticate,find=discover}={}) {
    Object.assign(this,{directory,operation,verify,find});this.devices=[];this.activeId=null;this.busy=false;this.online=false;this.error=null;
  }
  async init(){await fs.mkdir(this.directory,{recursive:true});try{
    const stored=JSON.parse(await fs.readFile(path.join(this.directory,'devices.json'),'utf8'));
    if(stored.version!==1||!Array.isArray(stored.devices))throw Error('format');
    this.devices=stored.devices;this.activeId=stored.activeId;
  }catch(e){if(e.code!=='ENOENT')throw Error('绑定记录无法读取，请保留文件并检查 Windows 用户权限');}}
  status(){return {busy:this.busy,online:this.online,error:this.error,activeId:this.activeId,devices:this.devices.map(({deviceId,name,host,pending})=>({deviceId,name,host,pending}))};}
  async exclusive(fn){if(this.busy)throw Error('正在处理另一项配对操作');this.busy=true;try{return await fn();}finally{this.busy=false;}}
  async save(){const temp=path.join(this.directory,'devices.'+hex(8)+'.tmp');await fs.writeFile(temp,JSON.stringify({version:1,activeId:this.activeId,devices:this.devices},null,2),{flag:'wx',mode:0o600});await fs.rename(temp,path.join(this.directory,'devices.json'));}
  async ports(){return this.operation('ports');}
  async serial(port,command,extra={}) {
    if(!/^COM[1-9][0-9]{0,3}$/.test(port))throw Error('请选择有效的 COM 串口');
    const requestId=hex(12), reply=await this.operation('exchange',{port,request:{version:1,requestId,command,...extra}});
    if(reply.requestId!==requestId||reply.version!==1)throw Error('设备响应不匹配');
    if(!reply.ok){const error=Error(({wifi_failed:'Wi-Fi 连接失败，请核对 2.4 GHz 网络名称和密码',storage_failed:'设备保存失败，请重试',wrong_device:'设备身份已变化，请重新识别',invalid_request:'设备拒绝配置参数'})[reply.error]??'设备未完成请求，请检查固件或重新连接');error.definitive=true;throw error;}
    if(!validId(reply.deviceId))throw Error('这不是受支持的 WDA 设备');return reply;
  }
  identify(port){return this.exclusive(async()=>{const d=await this.serial(port,'identify');return {deviceId:d.deviceId,paired:d.paired,host:d.host,version:d.version};});}
  pair({port,deviceId,name,ssid,password,replace=false}) {return this.exclusive(async()=>{
    if(!validId(deviceId)||typeof ssid!=='string'||!ssid.trim()||Buffer.byteLength(ssid)>31||ssid.includes('\0')||typeof password!=='string'||password.includes('\0')||(password.length>0&&Buffer.byteLength(password)<8)||Buffer.byteLength(password)>63)throw Error('请填写有效 Wi-Fi：名称不超过 31 字节，密码为 8–63 字节或留空');
    if(typeof name!=='string'||!name.trim()||name.length>48)throw Error('设备名称需为 1–48 个字符');
    const identity=await this.serial(port,'identify');if(identity.deviceId!==deviceId)throw Error('串口设备已变化，请重新识别');
    if(identity.paired&&!replace)throw Error('设备已有绑定，请确认替换绑定');
    const key=hex(32),sealed=(await this.operation('protect',{value:key})).value;
    const old=this.devices.find(d=>d.deviceId===deviceId);
    const pending={deviceId,name:name.trim(),host:identity.host||null,sealed,pending:true,previous:old?.previous??old};
    this.devices=this.devices.filter(d=>d.deviceId!==deviceId);this.devices.push(pending);await this.save();
    // Persist the recovery key BEFORE the device can commit it. No Wi-Fi password is saved on the PC.
    let reply;
    try{reply=await this.serial(port,'provision',{deviceId,ssid,password,key});}
    catch(e){
      if(e.definitive){this.devices=this.devices.filter(d=>d.deviceId!==deviceId);if(old)this.devices.push(old);await this.save();this.error=e.message;}
      else this.error='配网未确认，保留了恢复记录。可重试无线连接或重新 USB 配网。';
      throw e;
    }
    pending.host=reply.host;await this.save();
    try{await this.verify(reply.host,{deviceId,key});}catch{this.online=false;this.error='设备已配网，电脑尚无法通过局域网确认。请连接同一局域网后点击重新连接。';return this.status();}
    pending.pending=false;delete pending.previous;this.activeId=deviceId;this.online=true;this.error=null;await this.save();return this.status();
  });}
  async reconnectUnlocked(deviceId=this.activeId){
    const device=this.devices.find(d=>d.deviceId===deviceId);if(!device)return null;
    const key=(await this.operation('unprotect',{value:device.sealed})).value;
    if(!/^[a-f0-9]{64}$/.test(key))throw Error('绑定凭据无效');
    const binding={deviceId,key};let host;
    if(validIp(device.host)){try{host=await this.verify(device.host,binding);}catch{}}
    if(!host)for(const candidate of await this.find(binding)){try{host=await this.verify(candidate,binding);break;}catch{}}
    if(!host){this.online=false;this.error='设备离线或绑定不匹配；检查电源、同一局域网与防火墙，必要时重新 USB 配网';return null;}
    device.host=host;device.pending=false;delete device.previous;this.activeId=deviceId;this.online=true;this.error=null;await this.save();return host;
  }
  reconnect(deviceId){return this.exclusive(()=>this.reconnectUnlocked(deviceId));}
}
