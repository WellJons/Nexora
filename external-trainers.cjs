// User-approved external trainer launcher. Never runs an unapproved download or a shell.
// Catalog entries are pinned in the application source, not accepted from network/profile data.
const fs=require('node:fs'),fp=fs.promises,path=require('node:path'),{createHash,randomUUID}=require('node:crypto'),{Readable,Transform}=require('node:stream'),{pipeline}=require('node:stream/promises'),{spawn}=require('node:child_process');
const MAX_EXE=256*1024*1024,MAX_CT=2*1024*1024;
const PACKAGES=Object.freeze([Object.freeze({id:'gk2-wizardice-1.1.1',steamId:'steam:4358690',title:'GK2Trainer',version:'1.1.1',author:'wizardice',license:'Apache-2.0',name:'GK2Trainer.exe',size:129536,sha256:'79141fd6ff3e37aad64ef9a38b38ed6a58de9cf605876f7c7926cfe1293da509',url:'https://github.com/wizardice/GraveyardKeeper2-Trainer/releases/download/v1.1.1/GK2Trainer.exe',source:'https://github.com/wizardice/GraveyardKeeper2-Trainer/releases/tag/v1.1.1'})]);
function packageFor(game){return PACKAGES.find(p=>game?.id===p.steamId)||null}
function permanent(message){const e=Error(message);e.permanent=true;return e}
async function fileInfo(file,type){
 if(typeof file!=='string'||!path.isAbsolute(file)||path.extname(file).toLowerCase()!=='.'+type)throw permanent('Выберите файл .'+type);
 const resolved=await fp.realpath(file),s=await fp.lstat(file);if(!s.isFile()||s.isSymbolicLink()||s.size<16||s.size>(type==='exe'?MAX_EXE:MAX_CT))throw permanent('Недопустимый файл или ссылка');
 const hash=createHash('sha256');let head=Buffer.alloc(0),n=0;for await(const b of fs.createReadStream(resolved)){n+=b.length;if(n>s.size)throw permanent('Файл изменился');if(head.length<2)head=Buffer.concat([head,b.subarray(0,2-head.length)]);hash.update(b)}
 if(n!==s.size||type==='exe'&&head.toString()!=='MZ')throw permanent('Неверный формат файла');
 return {file:resolved,size:n,sha256:hash.digest('hex')}
}
async function verify(info,type){const now=await fileInfo(info.file,type);if(now.size!==info.size||now.sha256!==info.sha256||!samePath(now.file,info.file))throw permanent('Файл изменился с момента согласия. Подключите его заново.');return now.file}
function allowed(url){return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(url.hostname)}
async function asset(url,signal,fetcher){let u=new URL(url);for(let i=0;i<5;i++){if(!allowed(u))throw permanent('Недоверенный адрес загрузки');const r=await fetcher(u,{signal,redirect:'manual'});if(![301,302,303,307,308].includes(r.status)){if(!r.ok||!r.body)throw Error('GitHub HTTP '+r.status);return r}const next=r.headers.get('location');await r.body?.cancel();if(!next)throw Error('Нет адреса загрузки');u=new URL(next,u)}throw Error('Слишком много перенаправлений')}
function samePath(a,b){const x=path.resolve(a),y=path.resolve(b);return process.platform==='win32'?x.toLowerCase()===y.toLowerCase():x===y}
async function directory(folder,parent=null){await fp.mkdir(folder,{recursive:true});const s=await fp.lstat(folder),resolved=await fp.realpath(folder);if(!s.isDirectory()||s.isSymbolicLink()||parent&&!samePath(path.dirname(resolved),parent))throw permanent('Недопустимая папка пакетов');return resolved}
async function preparePackage(p,root,{signal,fetcher=fetch,progress=()=>{}}){
 if(!p||!PACKAGES.includes(p))throw permanent('Неизвестный пакет');
 root=await directory(root);const folder=await directory(path.join(root,p.id),root);const file=path.join(folder,p.name),expected={file,size:p.size,sha256:p.sha256};
 try{await verify(expected,'exe');return expected}catch(e){if(e.code!=='ENOENT')throw permanent('Кэш пакета изменён. Удалите его из менеджера и повторите загрузку.')}
 const tmp=path.join(folder,randomUUID()+'.tmp');try{const r=await asset(p.url,signal,fetcher);let n=0;const h=createHash('sha256');let head=Buffer.alloc(0);const guard=new Transform({transform(chunk,_e,cb){n+=chunk.length;if(n>p.size)return cb(Error('Размер пакета не совпадает'));if(head.length<2)head=Buffer.concat([head,chunk.subarray(0,2-head.length)]);h.update(chunk);progress(n,p.size);cb(null,chunk)}});
 await pipeline(Readable.fromWeb(r.body),guard,fs.createWriteStream(tmp,{flags:'wx'}),{signal});if(n!==p.size||head.toString()!=='MZ'||h.digest('hex')!==p.sha256)throw permanent('SHA-256 или размер пакета не совпадает.');
 if(signal.aborted)throw Error('Загрузка отменена');await fp.link(tmp,file);await verify(expected,'exe');return expected
 }finally{await fp.rm(tmp,{force:true}).catch(()=>{})}
}
async function cacheTable(root,bytes){const {inspect}=require('./ct-preview.cjs');inspect(bytes);root=await directory(root);const folder=await directory(path.join(root,'community-tables'),root);const sha256=createHash('sha256').update(bytes).digest('hex'),file=path.join(folder,sha256+'.ct'),item={file,size:bytes.length,sha256};try{await fp.writeFile(file,bytes,{flag:'wx'})}catch(e){if(e.code!=='EEXIST')throw e}await verify(item,'ct');return item}
function validInfo(v,type){return v&&typeof v.file==='string'&&path.isAbsolute(v.file)&&path.extname(v.file).toLowerCase()==='.'+type&&Number.isSafeInteger(v.size)&&v.size>=16&&v.size<=(type==='exe'?MAX_EXE:MAX_CT)&&/^[a-f0-9]{64}$/.test(v.sha256||'')}
function validEngine(v){return validInfo(v,'exe')&&/^cheatengine(?:[-_][a-z0-9_-]+)?\.exe$/i.test(path.basename(v.file))}
function validPreference(v,game){if(!v||v.gameId!==game?.id)return false;if(v.kind==='catalog'){const p=packageFor(game);return !!p&&v.packageId===p.id&&v.sha256===p.sha256}return v.kind==='local'&&validInfo(v.exe,'exe')&&(v.table===null||validInfo(v.table,'ct'))}
function createExternal({root,findGame,getPrefs,setPrefs,send=()=>{},fetcher=fetch,spawnFn=spawn,platform=process.platform}){
 let running=null,busy=false,controller=null,state={phase:'idle',gameId:null,message:'',pid:null,downloaded:0,total:0};
 const publish=p=>{state={...state,...p};send({...state});return {...state}};
 function preference(id){const g=findGame(id),v=getPrefs().find(x=>x?.gameId===id);return validPreference(v,g)?v:null}
 function set(id,value){const g=findGame(id);if(value&&!g?.installed)throw permanent('Сначала установите игру');if(busy||running?.id===id)throw permanent('Сначала закройте активный трейнер');if(value&&!validPreference(value,g))throw permanent('Неверная привязка');setPrefs([...getPrefs().filter(x=>x?.gameId!==id),...(value?[value]:[])].slice(-500));return info(id)}
 function bindings(){return getPrefs().filter(v=>v&&typeof v.gameId==='string').map(v=>{const g=findGame(v.gameId),i=info(v.gameId);return {gameId:v.gameId,name:g?.name||v.gameId,installed:!!g?.installed,configured:i.configured,label:i.label,table:i.table,kind:i.kind,state:i.state.phase}})}
 function info(id){const g=findGame(id),p=packageFor(g),pref=preference(id);return {gameId:id,package:p?{id:p.id,title:p.title,version:p.version,author:p.author,license:p.license,source:p.source,sha256:p.sha256}:null,configured:!!pref,kind:pref?.kind||null,label:pref?.kind==='catalog'?p?.title:pref?path.basename(pref.exe.file):null,table:pref?.table?(typeof pref.tableLabel==='string'&&pref.tableLabel.length<=350?pref.tableLabel:path.basename(pref.table.file)):null,state:state.gameId===id?{...state}:{phase:'idle',gameId:id,message:'',pid:null},occupied:!!running||busy}}
 async function launch(id,stillAllowed=()=>true){if(platform!=='win32')throw permanent('Внешние трейнеры доступны на Windows');if(busy)throw permanent('Трейнер уже подготавливается');if(running){if(running.id===id)return {connected:true,adapter:'external',pid:running.child.pid};throw permanent('Закройте предыдущий внешний трейнер')}
  const g=findGame(id),pref=preference(id);if(!g?.installed||!pref)throw permanent('Нет одобренного трейнера');busy=true;controller=new AbortController();const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(120000)]);publish({phase:'preparing',gameId:id,message:'Проверяем файлы трейнера…',pid:null,downloaded:0,total:0});
  try{let file,args=[];if(pref.kind==='catalog'){const p=packageFor(g);const item=await preparePackage(p,root,{signal,fetcher,progress:(downloaded,total)=>publish({phase:'downloading',downloaded,total,message:'Загрузка одобренного пакета…'})});file=await verify(item,'exe')}else{file=await verify(pref.exe,'exe');if(pref.table)args=[await verify(pref.table,'ct')]}
   if(signal.aborted||!await stillAllowed()||signal.aborted)throw permanent('Запуск отменён');const child=spawnFn(file,args,{cwd:path.dirname(file),shell:false,stdio:'ignore',windowsHide:false});const entry={id,child};running=entry;
   await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);child.once('exit',()=>reject(Error('Трейнер сразу завершился')))});
   if(running!==entry)throw permanent('Трейнер завершился');publish({phase:'started',message:'Внешний трейнер запущен. Проверьте подключение в его окне.',pid:child.pid});child.once('exit',()=>{if(running===entry){running=null;publish({phase:'closed',message:'Внешний трейнер закрыт.',pid:null})}});child.once('error',()=>{if(running===entry){running=null;publish({phase:'error',message:'Процесс трейнера завершился с ошибкой.',pid:null})}});child.unref?.();return {connected:true,adapter:'external',pid:child.pid}
  }catch(e){running=null;publish({phase:'error',message:String(e.message||e).slice(0,250),pid:null});throw permanent(String(e.message||e))}finally{busy=false;controller=null}
 }
 async function removeCache(id){const p=packageFor(findGame(id));if(!p||busy||running)throw permanent('Закройте трейнер');try{const canonical=await directory(root),folder=await directory(path.join(canonical,p.id),canonical),file=path.join(folder,p.name);const s=await fp.lstat(file);if(!s.isFile()||s.isSymbolicLink())throw permanent('Неверный файл кэша');await fp.unlink(file)}catch(e){if(e.code!=='ENOENT')throw e}return info(id)}
 return {info,bindings,preference,set,launch,removeCache,active:()=>!!running||busy,cancel:()=>controller?.abort(),close:()=>controller?.abort()}
}
module.exports={PACKAGES,packageFor,fileInfo,verify,preparePackage,cacheTable,validEngine,validPreference,createExternal};
