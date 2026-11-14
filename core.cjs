const fs = require('node:fs');
const path = require('node:path');
const catalog = [
 {id:'steam:4358690',name:'Graveyard Keeper 2',genre:'Симулятор · RPG',color:'#472149'},
 {id:'steam:1091500',name:'Cyberpunk 2077',genre:'Открытый мир · RPG',color:'#665919'},
 {id:'steam:1086940',name:"Baldur's Gate 3",genre:'Фэнтези · RPG',color:'#25435e'},
 {id:'steam:1245620',name:'Elden Ring',genre:'Экшен · RPG',color:'#454b36'},
 {id:'steam:1174180',name:'Red Dead Redemption 2',genre:'Приключения',color:'#6d2523'},
 {id:'steam:292030',name:'The Witcher 3: Wild Hunt',genre:'Фэнтези · RPG',color:'#443d37'},
 {id:'steam:489830',name:'The Elder Scrolls V: Skyrim Special Edition',genre:'Фэнтези · RPG',color:'#414754'},
 {id:'steam:377160',name:'Fallout 4',genre:'Постапокалипсис · RPG',color:'#37564c'},
];
function read(p){try{return fs.readFileSync(p,'utf8')}catch{return ''}}
function field(s,k){const m=s.match(new RegExp('"'+k+'"\\s*"((?:\\\\.|[^"\\\\])*)"','i'));return m?m[1].replace(/\\\\/g,'\\').replace(/\\"/g,'"'):''}
function discoverSteam(root){
 const roots=new Set([root]);const vdf=read(path.join(root,'steamapps','libraryfolders.vdf'));
 for(const m of vdf.matchAll(/"path"\s*"((?:\\.|[^"\\])*)"/gi))roots.add(m[1].replace(/\\\\/g,'\\'));
 const games=new Map();
 for(const base of roots){const dir=path.join(base,'steamapps');let entries;try{entries=fs.readdirSync(dir)}catch{continue}
 for(const f of entries){if(!/^appmanifest_\d+\.acf$/i.test(f))continue;const s=read(path.join(dir,f));const id=field(s,'appid'),name=field(s,'name'),folder=field(s,'installdir');
 if(!/^\d+$/.test(id)||!name||!folder||folder!==path.basename(folder)||folder==='..'||folder==='.')continue;
 const installedPath=path.join(dir,'common',folder);try{if(!fs.statSync(installedPath).isDirectory())continue}catch{continue}
 games.set('steam:'+id,{id:'steam:'+id,name,path:installedPath,installed:true,kind:'steam',buildId:/^\d+$/.test(field(s,'buildid'))?field(s,'buildid'):null});
 }}return [...games.values()].sort((a,b)=>a.name.localeCompare(b.name));
}
function mergeGames(installed,manual,profiles=[]){const result=new Map(catalog.map(g=>[g.id,{...g,installed:false,kind:'steam'}]));for(const g of profiles)if(!result.has(g.id))result.set(g.id,{...g,installed:false});for(const g of [...installed,...manual])result.set(g.id,{...result.get(g.id),...g});return [...result.values()]}
function copySave(src,dest){
 const from=fs.realpathSync(src);fs.mkdirSync(dest,{recursive:true});const to=fs.realpathSync(dest);
 const norm=p=>process.platform==='win32'?p.toLowerCase():p;
 if(norm(to)===norm(from)||norm(to).startsWith(norm(from+path.sep)))throw Error('Папка копии не должна находиться внутри сохранений');
 const target=fs.mkdtempSync(path.join(to,'save-'));
 try{for(const entry of fs.readdirSync(from)){const source=path.join(from,entry);if(fs.lstatSync(source).isSymbolicLink())continue;fs.cpSync(source,path.join(target,entry),{recursive:true,filter:p=>!fs.lstatSync(p).isSymbolicLink(),errorOnExist:true,force:false})}return target}catch(e){fs.rmSync(target,{recursive:true,force:true});throw e}
}
module.exports={catalog,discoverSteam,mergeGames,copySave};
