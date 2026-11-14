const fs=require('node:fs'),{spawn}=require('node:child_process'),readline=require('node:readline');
const {createBridge}=require('./memory-bridge.cjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function createDemo(exe,{spawnChild=spawn,bridgeFactory=createBridge}={}){
 let child=null,pending=null,lines=null,engine=null,busy=false,info=null;
 let state={running:false,gold:null,health:null,error:'',verified:false};
 function snapshot(){return {...state,busy}}
 function finish(err,v){if(!pending)return;const p=pending;pending=null;clearTimeout(p.timer);err?p.reject(err):p.resolve(v)}
 function close(){const p=child;child=null;info=null;finish(Error('Арена закрыта'));lines?.close();lines=null;engine?.close();engine=null;if(p&&!p.killed){try{p.stdin.end()}catch{}p.kill()}state={running:false,gold:null,health:null,error:'',verified:false}}
 function expect(){if(pending)throw Error('Арена занята');return new Promise((resolve,reject)=>{pending={resolve,reject,timer:setTimeout(()=>{finish(Error('Арена не отвечает'));close()},15000)}})}
 async function command(op){if(!child||!['status','earn','hit','heal'].includes(op))throw Error('Арена не запущена');const p=expect();child.stdin.write(op+'\n');const r=await p;if(!r?.ok||!Number.isSafeInteger(r.gold)||!Number.isSafeInteger(r.health))throw Error('Неверный ответ арены');state={...state,running:true,gold:r.gold,health:r.health};return snapshot()}
 async function start(){
  if(child)return command('status');if(process.platform!=='win32'||!fs.existsSync(exe))throw Error('Требуется Windows-сборка Nexora');
  const p=spawnChild(exe,['--training-demo'],{windowsHide:true,stdio:['pipe','pipe','ignore']});child=p;
  lines=readline.createInterface({input:p.stdout,crlfDelay:Infinity});const ready=expect();
  lines.on('line',s=>{if(child!==p)return;try{finish(null,JSON.parse(s))}catch{finish(Error('Неверный ответ арены'));close()}});
  p.on('error',e=>{if(child===p){finish(e);close()}});p.stdin.on('error',e=>{if(child===p){finish(e);close()}});p.on('exit',()=>{if(child===p)close()});
  const r=await ready;if(!r?.ready||r.pid!==p.pid||!['goldAddress','healthAddress'].every(k=>typeof r[k]==='string'&&/^[0-9A-F]{1,16}$/.test(r[k])))throw Error('Неверная идентификация арены');
  info=r;engine=bridgeFactory(exe);await engine.request('attach',{root:fs.realpathSync(exe),exact:true,pid:info.pid});return command('status')
 }
 async function setGold(){if(!info||!engine)throw Error('Запусти арену');await command('status');const before=state.gold;
  // Use the same ordinary scanner as the manual editor and only a known allocation in our own child.
  await engine.request('scan',{kind:'int32',value:before});await command('earn');
  const candidates=await engine.request('refine',{value:state.gold});const row=candidates.rows.find(r=>r.address===info.goldAddress);
  if(!row)throw Error('Тестовый адрес не найден. Проверка не пройдена.');
  await engine.request('write',{address:row.address,value:888888888});await command('status');if(state.gold!==888888888)throw Error('Проверка записи не пройдена');state.verified=true;return snapshot()
 }
 async function action(op){if(busy)throw Error('Дождись завершения операции');busy=true;try{if(op==='start')await start();else if(op==='stop')close();else if(op==='gold')await setGold();else await command(op);state.error=''}catch(e){close();state.error=String(e.message||e);throw e}finally{busy=false}return snapshot()}
 return {action,state:snapshot,close};
}
module.exports={createDemo};
