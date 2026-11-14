const fs=require('node:fs'),path=require('node:path');
function safeToken(v){return typeof v==='string'&&/^[a-zA-Z0-9_.-]{1,180}$/.test(v)}
function contained(root,relative){
 if(!path.isAbsolute(root)||typeof relative!=='string'||!relative||path.isAbsolute(relative))return null;
 const p=path.resolve(root,relative),rel=path.relative(root,p);if(!rel||rel.startsWith('..'+path.sep)||rel==='..'||path.isAbsolute(rel))return null;
 try{const rr=fs.realpathSync(root),rp=fs.realpathSync(p),r=path.relative(rr,rp);if(r==='..'||r.startsWith('..'+path.sep)||path.isAbsolute(r)||!fs.statSync(rp).isFile())return null;return rp}catch{return null}
}
function discoverEpic(dir){
 const results=new Map();let items;try{items=fs.readdirSync(dir)}catch{return []}
 for(const file of items){if(!file.toLowerCase().endsWith('.item'))continue;try{
 const m=JSON.parse(fs.readFileSync(path.join(dir,file),'utf8').replace(/^\uFEFF/,''));
 if(!safeToken(m.AppName)||typeof m.DisplayName!=='string'||!m.DisplayName.trim()||typeof m.InstallLocation!=='string'||m.bIsIncompleteInstall||m.bIsApplication===false)continue;
 if(m.MainGameAppName&&m.MainGameAppName!==m.AppName)continue;
 const exe=contained(m.InstallLocation,m.LaunchExecutable);if(!exe||path.extname(exe).toLowerCase()!=='.exe')continue;
 const id='epic:'+m.AppName,launch=safeToken(m.CatalogNamespace)&&safeToken(m.CatalogItemId)?[m.CatalogNamespace,m.CatalogItemId,m.AppName].join(':'):m.AppName;
 results.set(id,{id,name:m.DisplayName.trim().slice(0,180),path:m.InstallLocation,exe,kind:'epic',installed:true,launch});
 }catch{}}
 return [...results.values()].sort((a,b)=>a.name.localeCompare(b.name))
}
function epicUri(g){if(g.kind!=='epic'||typeof g.launch!=='string'||!g.launch.split(':').every(safeToken)||![1,3].includes(g.launch.split(':').length))throw Error('Не удалось определить Epic ID');return 'com.epicgames.launcher://apps/'+encodeURIComponent(g.launch)+'?action=launch&silent=true'}
function profileText(v,max){if(typeof v!=='string'||v.length>max)throw Error('Слишком длинное или недопустимое поле');return v.trim()}
function normalizeProfile(p){if(!p||typeof p!=='object'||!Array.isArray(p.tasks)||p.tasks.length>40)throw Error('Некорректный профиль');return {notes:profileText(p.notes,12000),tasks:p.tasks.map(t=>{if(!t||typeof t.done!=='boolean')throw Error('Некорректная задача');return {text:profileText(t.text,250),done:t.done}}).filter(t=>t.text)}}
function recordLaunch(items,g,now=new Date()){return [{gameId:g.id,name:g.name,provider:g.kind,at:now.toISOString()},...items].slice(0,1000)}
module.exports={discoverEpic,epicUri,normalizeProfile,recordLaunch,contained};
