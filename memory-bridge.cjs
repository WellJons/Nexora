const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process'),readline=require('node:readline');
function gameScope(g){
 if(!g?.installed||!['steam','epic','local'].includes(g.kind)||typeof g.path!=='string')throw Error('Выберите установленную игру');
 const root=fs.realpathSync(g.path),stat=fs.statSync(root),exact=g.kind==='local';
 if(exact?(!stat.isFile()||path.extname(root).toLowerCase()!=='.exe'):(!stat.isDirectory()||path.dirname(root)===root))throw Error('Неверный путь игры');
 const blocked=[process.env.SystemRoot,process.env.ProgramData,process.env.USERPROFILE].filter(Boolean).map(p=>path.resolve(p).toLowerCase());
 if(blocked.some(p=>root.toLowerCase()===p)||process.env.SystemRoot&&root.toLowerCase().startsWith(path.resolve(process.env.SystemRoot).toLowerCase()+path.sep))throw Error('Системные каталоги не поддерживаются');
 return {root,exact};
}
function createBridge(executable){
 let child=null,pending=null,lines=null;
 function finish(err,value){if(!pending)return;const p=pending;pending=null;clearTimeout(p.timer);err?p.reject(err):p.resolve(value)}
 function close(reason='Сессия завершена'){const p=child;child=null;if(lines){lines.close();lines=null}finish(Error(reason));if(p&&!p.killed)p.kill()}
 function start(){
  if(child)return;
  if(process.platform!=='win32'||!fs.existsSync(executable))throw Error('Встроенный движок отсутствует. Используйте готовую Windows-сборку Nexora.');
  const p=spawn(executable,[],{windowsHide:true,stdio:['pipe','pipe','ignore']});child=p;
  lines=readline.createInterface({input:p.stdout,crlfDelay:Infinity});
  lines.on('line',line=>{if(child!==p||!pending)return;try{const msg=JSON.parse(line);if(msg.ok===true)finish(null,msg.data);else finish(Error(msg.error||'Ошибка движка'))}catch{close('Некорректный ответ движка')}});
  p.on('error',e=>{if(child===p)close(e.message)});p.stdin.on('error',e=>{if(child===p)close(e.message)});p.on('exit',()=>{if(child===p)close('Движок завершился. Выберите игру заново.')});
 }
 function request(op,args={}){
  if(pending)return Promise.reject(Error('Дождитесь завершения сканирования'));
  try{start()}catch(e){return Promise.reject(e)}
  return new Promise((resolve,reject)=>{pending={resolve,reject,timer:setTimeout(()=>close('Превышено время операции. Сессия завершена.'),120000)};child.stdin.write(JSON.stringify({op,...args})+'\n')})
 }
 return {request,close};
}
function numeric(value){if(typeof value!=='number'||!Number.isFinite(value))throw Error('Введите конечное число');return value}
module.exports={gameScope,createBridge,numeric};
