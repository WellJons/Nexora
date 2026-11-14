const fs=require('node:fs'),path=require('node:path');
const bundled=require('./data/game-profiles.json');
const CATEGORIES=Object.freeze({currency:'Валюта',tools:'Инструменты',materials:'Материалы',gems:'Драгоценности',health:'Еда и лечение',ammo:'Боеприпасы',blocks:'Блоки',weapons:'Оружие',armor:'Экипировка',other:'Прочее'});
const ENGINES=new Set(['bethesda-skyrim','bethesda-fallout4','minecraft','manual','gk2-save']);
const MAX=16*1024*1024;
function text(v,n){if(typeof v!=='string'||!v.trim()||v.length>n||/[\x00-\x1f\x7f]/.test(v))throw Error('Invalid profile text');return v}
function key(v){if(typeof v!=='string'||!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(v))throw Error('Invalid identifier');return v}
function unique(rows,get){const seen=new Set();for(const r of rows){const k=get(r);if(seen.has(k))throw Error('Duplicate identifier');seen.add(k)}return rows}
function arr(v,n){if(!Array.isArray(v)||v.length>n)throw Error('Invalid profile array');return v}
function safeCommand(engine,cmd){
 text(cmd,200);
 if(engine.startsWith('bethesda-'))return /^(?:tgm|tcl|player\.resethealth|player\.additem [a-fA-F0-9]{8} [0-9]{1,5})$/.test(cmd);
 if(engine==='minecraft')return /^\/(?:give @s minecraft:[a-z0-9_]+ [0-9]{1,4}|effect (?:give @s minecraft:[a-z0-9_]+ [0-9]{1,4} [0-9]{1,2} true|clear @s minecraft:[a-z0-9_]+)|gamemode (?:creative|survival))$/.test(cmd);
 // Unknown engines only expose descriptive profiles. No remote executable text.
 return false
}
function validate(raw){
 if(!raw||raw.schema!==1||!Number.isSafeInteger(raw.revision)||raw.revision<1)throw Error('Unsupported catalog schema');
 const games=unique(arr(raw.games,5000).map(g=>{const id=key(g.id),engine=g.engine;if(!ENGINES.has(engine))throw Error('Unknown engine');
  const steamIds=unique(arr(g.steamIds,20).map(x=>{if(typeof x!=='string'||!/^[0-9]{1,12}$/.test(x))throw Error('Invalid Steam ID');return x}),x=>x);
  const aliases=arr(g.aliases,20).map(x=>text(x,100).toLowerCase());
  const commands=unique(arr(g.commands,100).map(c=>{if(!safeCommand(engine,c.command))throw Error('Unsupported game command');return {id:key(c.id),name:text(c.name,100),command:c.command}}),x=>x.id);
  const items=unique(arr(g.items,15000).map(i=>{if(typeof i.id!=='string'||!(engine.startsWith('bethesda-')?/^[a-fA-F0-9]{8}$/.test(i.id):engine==='minecraft'?/^[a-z0-9_]{1,100}$/.test(i.id):false)||!Object.hasOwn(CATEGORIES,i.category))throw Error('Unsupported item');return {id:i.id,ru:text(i.ru,150),en:text(i.en,150),category:i.category}}),x=>x.id.toLowerCase());
  return {id,name:text(g.name,150),shortName:text(g.shortName,40),hint:text(g.hint,500),engine,steamIds,aliases,commands,items}
 }),g=>g.id);unique(games.flatMap(g=>g.steamIds),x=>x);
 return {schema:1,revision:raw.revision,games}
}
let active=validate(bundled),byId,bySteam;
function rebuild(){byId=new Map(active.games.map(g=>[g.id,g]));bySteam=new Map(active.games.flatMap(g=>g.steamIds.map(id=>[id,g.id])))}rebuild();
const find=id=>byId.get(id);
function match(g){if(!g)return null;const steam=String(g.id||'').match(/^steam:(\d+)$/)?.[1];if(steam)return bySteam.get(steam)||null;
 if(String(g.id||'').startsWith('profile:'))return find(g.id.slice(8))?.id||null;
 const n=String(g.name||'').toLowerCase();const matches=active.games.filter(p=>p.aliases.some(a=>n.includes(a)));return matches.length===1?matches[0].id:null}
function metadata(){return active.games.map(({id,name,shortName,hint,engine,commands,items})=>({id,name,shortName,hint,engine,items:commands,itemCount:items.length}))}
function summaries(){return active.games.map(g=>({id:g.id,name:g.name,shortName:g.shortName,engine:g.engine,itemCount:g.items.length,commandCount:g.commands.length}))}
function details(id){const g=find(id);if(!g)throw Error('Профиль не найден');return {id:g.id,name:g.name,shortName:g.shortName,engine:g.engine,hint:g.hint,items:g.commands,itemCount:g.items.length}}
function libraryEntries(){return active.games.map(g=>({id:g.steamIds.length?'steam:'+g.steamIds[0]:'profile:'+g.id,name:g.name,kind:g.steamIds.length?'steam':'catalog',installed:false,genre:'Игровой профиль'}))}
function profileState(){return {revision:active.revision,count:active.games.length}}
function loadCache(root){try{const file=path.join(root,'game-profiles-cache.json');const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.size>MAX)return;const next=validate(JSON.parse(fs.readFileSync(file,'utf8')));if(next.revision>active.revision){active=next;rebuild()}}catch{}return profileState()}
let pending=null;
async function sync(root,fetcher=fetch){
 if(pending)return pending;
 pending=(async()=>{const response=await fetcher('https://raw.githubusercontent.com/WellJons/Nexora/main/data/game-profiles.json',{redirect:'error',signal:AbortSignal.timeout(15000)});if(!response.ok||!response.body)throw Error('Каталог недоступен: '+response.status);
 const reader=response.body.getReader();let size=0,parts=[];try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX)throw Error('Каталог слишком большой');parts.push(Buffer.from(value))}}finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
 const next=validate(JSON.parse(Buffer.concat(parts).toString('utf8')));if(next.revision<=active.revision)return {...profileState(),updated:false};
 const dest=path.join(root,'game-profiles-cache.json'),tmp=path.join(root,'game-profiles-'+require('node:crypto').randomUUID()+'.tmp');try{await fs.promises.writeFile(tmp,JSON.stringify(next),{flag:'wx'});await fs.promises.rename(tmp,dest)}finally{await fs.promises.rm(tmp,{force:true})}
 active=next;rebuild();return {...profileState(),updated:true}
 })();try{return await pending}finally{pending=null}
}
module.exports={CATEGORIES,validate,find,match,metadata,summaries,details,libraryEntries,profileState,loadCache,sync};
