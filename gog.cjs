const fs=require('node:fs'),path=require('node:path');
const {contained}=require('./library.cjs');
function parseGog(text){
 const entries=[];let row=null;
 for(const line of String(text).split(/\r?\n/)){
  const key=line.trim().match(/^HKEY_LOCAL_MACHINE\\(?:SOFTWARE\\(?:WOW6432Node\\)?)GOG\.com\\Games\\(\d+)$/i);
  if(key){row={id:key[1]};entries.push(row);continue}
  if(/^HKEY_/i.test(line.trim())){row=null;continue}
  const val=line.match(/^\s+(\S+)\s+REG_(?:SZ|EXPAND_SZ)\s+(.*?)\s*$/i);
  if(row&&val)row[val[1].toLowerCase()]=val[2];
 }
 return entries;
}
function discoverGog(text){const games=new Map();for(const entry of parseGog(text)){try{
 const folder=entry.path,name=entry.gamename||entry.name,raw=entry.exe;
 if(!folder||!name||!raw||!path.isAbsolute(folder))continue;
 const root=fs.realpathSync(folder),relative=path.isAbsolute(raw)?path.relative(root,raw):raw,exe=contained(root,relative);
 if(!exe||path.extname(exe).toLowerCase()!=='.exe')continue;
 const id='gog:'+entry.id;games.set(id,{id,name:name.slice(0,180),path:root,exe,kind:'gog',installed:true});
 }catch{}}return [...games.values()].sort((a,b)=>a.name.localeCompare(b.name))}
module.exports={parseGog,discoverGog};
