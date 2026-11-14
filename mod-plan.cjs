const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const manager=require('./manager.cjs');
const MAX_MODS=32,MAX_BYTES=512*1024*1024;
const validId=v=>typeof v==='string'&&/^[a-zA-Z0-9]{8}$/.test(v);
function compatible(v,game,loader){return Array.isArray(v.game_versions)&&v.game_versions.includes(game)&&Array.isArray(v.loaders)&&v.loaders.includes(loader)}
function validateTarget(game,loader){if(typeof game!=='string'||!/^[a-zA-Z0-9._-]{1,40}$/.test(game)||!['fabric','forge','quilt','neoforge'].includes(loader))throw Error('Выберите точную версию Minecraft и загрузчик')}
function newest(list){return [...list].filter(x=>x.version_type==='release').sort((a,b)=>Date.parse(b.date_published)-Date.parse(a.date_published))[0]}
async function resolvePlan(api,{project,version,filename,game,loader}){
 validateTarget(game,loader);if(!validId(project)||!validId(version))throw Error('Некорректный мод');
 const seen=new Map(),ordered=[],blocked=[],names=new Set();let size=0;
 async function visit(p,v,explicitName){
  if(!validId(p)||!v||!validId(v.id)||v.project_id!==p||!compatible(v,game,loader))throw Error('Несовместимая или неизвестная версия зависимости');
  if(seen.has(p)){if(seen.get(p)!==v.id)throw Error('Конфликт требуемых версий: '+p);return}
  if(seen.size>=MAX_MODS)throw Error('Слишком много зависимостей');seen.set(p,v.id);
  const candidates=(v.files||[]).filter(api.validFile);const f=explicitName?candidates.find(x=>x.filename===explicitName):candidates.find(x=>x.primary)||(candidates.length===1?candidates[0]:null);
  if(!f)throw Error('Нет однозначно выбранного JAR для '+p);manager.filename(f.filename);
  const key=f.filename.toLowerCase();if(names.has(key))throw Error('Совпадающие имена файлов: '+f.filename);names.add(key);
  size+=f.size;if(size>MAX_BYTES)throw Error('Размер плана превышает 512 МиБ');
  const dependencies=v.dependencies||[];
  for(const dep of dependencies){if(dep.dependency_type==='incompatible'){blocked.push(dep);continue}if(dep.dependency_type!=='required')continue;
   let dv,dp=dep.project_id;
   if(dep.version_id){if(!validId(dep.version_id))throw Error('Неизвестный идентификатор зависимости');dv=await api.getVersion(dep.version_id);dp=dp||dv.project_id}
   else if(validId(dp)){if(seen.has(dp))continue;dv=newest((await api.getVersions(dp,game,loader)).filter(x=>compatible(x,game,loader)))}
   else throw Error('Обязательная зависимость без идентификатора проекта; установите вручную');
   await visit(dp,dv,null);
  }
  ordered.push({project:p,version:v.id,name:v.name||v.version_number||p,number:v.version_number,file:f,root:p===project});
 }
 const root=await api.getVersion(version);await visit(project,root,filename);
 for(const b of blocked)if(ordered.some(x=>x.project===b.project_id&&(!b.version_id||b.version_id===x.version)||x.version===b.version_id))throw Error('План содержит несовместимые моды');
 return {project,version,game,loader,size,items:ordered,incompatible:blocked.map(x=>({project:x.project_id||null,version:x.version_id||null}))};
}
function preview(plan){return {game:plan.game,loader:plan.loader,size:plan.size,items:plan.items.map(x=>({project:x.project,version:x.version,name:x.name,number:x.number,filename:x.file.filename,size:x.file.size,root:x.root})),incompatible:plan.incompatible}}
async function installPlan(api,plan,folder,installed){
 const dir=await fs.promises.realpath(folder);if(path.basename(dir).toLowerCase()!=='mods'||!(await fs.promises.stat(dir)).isDirectory())throw Error('Выберите существующую папку mods');
 const same=p=>process.platform==='win32'?p.toLowerCase()===dir.toLowerCase():p===dir;
 const local=installed.filter(x=>typeof x.folder==='string'&&same(x.folder)),todo=[];
 for(const b of plan.incompatible){if(local.some(x=>(b.project&&x.project===b.project&&(!b.version||x.version===b.version))||(b.version&&x.version===b.version)))throw Error('В профиле есть несовместимый мод')}
 for(const item of plan.items){
  const existing=local.filter(x=>x.project===item.project);
  if(existing.length){if(existing.length!==1||existing[0].version!==item.version||existing[0].sha512.toLowerCase()!==item.file.hashes.sha512.toLowerCase()||await manager.status(existing[0])!=='active')throw Error('Конфликт или отключённая зависимость: '+item.name);await manager.verify(path.join(dir,manager.filename(existing[0].name)),existing[0]);continue}
  for(const n of [item.file.filename,item.file.filename+'.nexora-disabled']){try{await fs.promises.lstat(path.join(dir,n));throw Error('Файл уже существует: '+n)}catch(e){if(e.code!=='ENOENT')throw e}}
  todo.push(item);
 }
 const temp=await fs.promises.mkdtemp(path.join(os.tmpdir(),'nexora-plan-'));const added=[];
 try{
  for(const [i,item] of todo.entries()){const staged=path.join(temp,String(i)+'.jar');const info=await api.download(item.file,staged);item.staged={name:item.file.filename,path:staged,...info}}
  for(const item of todo){const record=await manager.install(item.staged,dir);added.push({...record,project:item.project,version:item.version,game:plan.game,loader:plan.loader,title:item.name,number:item.number})}
  return added;
 }catch(error){
  const failed=[];for(const record of added.reverse()){const target=path.join(dir,record.name);try{await manager.verify(target,record);await fs.promises.unlink(target)}catch{failed.push(record.name)}}
  if(failed.length)throw Error(error.message+'; не удалось откатить: '+failed.join(', '));
  throw error;
 }finally{await fs.promises.rm(temp,{recursive:true,force:true})}
}
async function checkUpdate(api,m,game,loader){
 validateTarget(game,loader);if(!validId(m.project)||!validId(m.version))throw Error('Неизвестный мод');
 const current=await api.getVersion(m.version);if(current.project_id!==m.project||!compatible(current,game,loader))return {status:'incompatible'};
 const available=newest((await api.getVersions(m.project,game,loader)).filter(x=>compatible(x,game,loader)));
 if(!available||available.id===current.id||!(Date.parse(available.date_published)>Date.parse(current.date_published)))return {status:'current'};
 return {status:'available',id:available.id,number:available.version_number,name:available.name};
}
module.exports={resolvePlan,preview,installPlan,checkUpdate,validateTarget};
