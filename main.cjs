const {app,BrowserWindow,ipcMain,dialog,shell,session}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const {execFileSync,spawn}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const {discoverSteam,mergeGames,copySave}=require('./core.cjs');
const mods=require('./mods.cjs');
const manager=require('./manager.cjs');
const {makeMonitor}=require('./performance.cjs');
const monitor=makeMonitor(require('systeminformation'));
const {discoverEpic,epicUri,normalizeProfile,recordLaunch}=require('./library.cjs');
const trainer=require('./trainer-tools.cjs');
let managerBusy=false;
async function exclusive(fn){if(managerBusy)throw Error('Дождитесь завершения другой операции с модами');managerBusy=true;try{return await fn()}finally{managerBusy=false}}
let win,state={manual:[],favorites:[],history:[],backups:[],downloads:[],installedMods:[],profiles:[],launchLog:[],engines:[],tables:[]},games=[];
const config=()=>path.join(app.getPath('userData'),'library.json');
function persist(){const p=config();fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p+'.tmp',JSON.stringify(state,null,2));fs.renameSync(p+'.tmp',p)}
function load(){try{const v=JSON.parse(fs.readFileSync(config(),'utf8'));for(const key of Object.keys(state))if(Array.isArray(v[key]))state[key]=v[key]}catch{}}
function steamRoots(){
 if(process.platform!=='win32')return [];
 const roots=[path.join(process.env['ProgramFiles(x86)']||'C:\\Program Files (x86)','Steam')];
 try{const out=execFileSync('reg.exe',['query','HKCU\\Software\\Valve\\Steam','/v','SteamPath'],{encoding:'utf8',windowsHide:true,timeout:3000});const m=out.match(/REG_SZ\s+(.+)/i);if(m)roots.unshift(m[1].trim())}catch{}
 return [...new Set(roots)];
}
function refresh(scan=true){if(scan){const all=steamRoots().flatMap(discoverSteam);if(process.platform==='win32'&&process.env.ProgramData)all.push(...discoverEpic(path.join(process.env.ProgramData,'Epic','EpicGamesLauncher','Data','Manifests')));const manual=state.manual.map(g=>({...g,installed:typeof g.path==='string'&&fs.existsSync(g.path)}));games=mergeGames(all,manual)}return {games,favorites:state.favorites,history:state.history,backups:state.backups,downloads:state.downloads,installedMods:state.installedMods,profiles:state.profiles,launchLog:state.launchLog,engines:state.engines,tables:state.tables}}
function safeHandler(name,fn){ipcMain.handle(name,async(e,...args)=>{if(!win||e.sender!==win.webContents||e.senderFrame!==win.webContents.mainFrame)throw Error('Invalid origin');return fn(...args)})}
safeHandler('library:list',refresh);
safeHandler('library:add',async()=>{const r=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'Windows game',extensions:['exe']}]});if(r.canceled)return refresh();const p=r.filePaths[0];if(path.extname(p).toLowerCase()!=='.exe')throw Error('Выберите EXE игры');if(!state.manual.some(g=>g.path===p)){state.manual.push({id:'local:'+randomUUID(),name:path.basename(p,'.exe'),path:p,installed:true,kind:'local'});persist()}return refresh()});
safeHandler('library:favorite',id=>{if(!games.some(g=>g.id===id))throw Error('Игра не найдена');state.favorites=state.favorites.includes(id)?state.favorites.filter(v=>v!==id):[...state.favorites,id];persist();return refresh()});
safeHandler('library:launch',async id=>{const g=games.find(g=>g.id===id&&g.installed);if(!g)throw Error('Сначала установите или добавьте игру');if(g.kind==='steam'&&/^steam:\d+$/.test(g.id)){await shell.openExternal('steam://rungameid/'+g.id.slice(6))}else if(g.kind==='epic'){await shell.openExternal(epicUri(g))}else if(g.kind==='local'&&path.extname(g.path).toLowerCase()==='.exe'){await new Promise((resolve,reject)=>{const p=spawn(g.path,[],{cwd:path.dirname(g.path),detached:true,stdio:'ignore',windowsHide:false});p.once('error',reject);p.once('spawn',()=>{p.unref();resolve()})})}else throw Error('Неизвестный тип игры');state.history=[id,...state.history.filter(v=>v!==id)].slice(0,15);state.launchLog=recordLaunch(state.launchLog,g);persist();return refresh(false)});
safeHandler('saves:backup',async id=>{const g=games.find(g=>g.id===id);if(!g)throw Error('Выберите игру');const r=await dialog.showOpenDialog(win,{title:'Выберите папку сохранений',properties:['openDirectory']});if(r.canceled)return refresh();const target=copySave(r.filePaths[0],path.join(app.getPath('userData'),'backups'));state.backups.unshift({id:randomUUID(),game:g.name,path:target,date:new Date().toISOString()});persist();return refresh()});
safeHandler('saves:open',async id=>{const b=state.backups.find(b=>b.id===id);if(!b)throw Error('Копия не найдена');const error=await shell.openPath(b.path);if(error)throw Error(error);return true});
safeHandler('mods:search',(q,game,loader)=>mods.search(q,game,loader));
safeHandler('mods:versions',(project,game,loader)=>mods.versions(project,game,loader));
safeHandler('mods:download',async(project,version,name)=>{
 const f=await mods.resolveFile(project,version,name);
 const r=await dialog.showSaveDialog(win,{title:'Скачать мод (не устанавливает и не запускает файл)',defaultPath:path.join(app.getPath('downloads'),f.filename),filters:[{name:'Minecraft mod',extensions:['jar']}]});
 if(r.canceled)return null;
 if(path.extname(r.filePath).toLowerCase()!=='.jar')throw Error('Выберите файл .jar');
 const result=await mods.download(f,r.filePath);
 state.downloads.unshift({id:randomUUID(),name:path.basename(r.filePath),path:r.filePath,provider:'Modrinth',project,version,date:new Date().toISOString(),...result});
 state.downloads=state.downloads.slice(0,100);persist();return refresh();
});
safeHandler('mods:show',id=>{const d=state.downloads.find(v=>v.id===id);if(!d)throw Error('Загрузка не найдена');shell.showItemInFolder(d.path);return true});
safeHandler('manager:list',async()=>Promise.all(state.installedMods.map(async m=>({...m,status:await manager.status(m)}))));
safeHandler('manager:install',id=>exclusive(async()=>{
 const d=state.downloads.find(x=>x.id===id);if(!d)throw Error('Сначала скачайте мод через Nexora');
 const result=await dialog.showOpenDialog(win,{title:'Выберите папку mods нужного профиля Minecraft',properties:['openDirectory']});
 if(result.canceled)return null;
 const confirmation=await dialog.showMessageBox(win,{type:'warning',buttons:['Отмена','Установить'],defaultId:0,cancelId:0,title:'Установка мода',message:d.name,detail:'Папка: '+result.filePaths[0]+'\nЗакройте Minecraft. Устанавливайте только доверенные моды. Убедитесь, что версия игры, загрузчик и зависимости подходят. Nexora не проверяет мод на вредоносный код.'});
 if(confirmation.response!==1)return null;
 const installed=await manager.install(d,result.filePaths[0]);
 state.installedMods.unshift({...installed,id:randomUUID(),project:d.project,version:d.version,date:new Date().toISOString()});
 persist();return refresh();
}));
safeHandler('manager:toggle',(id,enabled)=>exclusive(async()=>{
 if(typeof enabled!=='boolean')throw Error('Некорректное действие');
 const m=state.installedMods.find(x=>x.id===id);if(!m)throw Error('Мод не управляется Nexora');
 const confirm=await dialog.showMessageBox(win,{type:'question',buttons:['Отмена',enabled?'Включить':'Отключить'],defaultId:0,cancelId:0,message:m.name,detail:'Перед изменением закройте Minecraft. Файл будет переименован без перезаписи других модов.'});
 if(confirm.response!==1)return null;
 await manager.toggle(m,enabled);return refresh();
}));
safeHandler('manager:folder',async id=>{const m=state.installedMods.find(x=>x.id===id);if(!m)throw Error('Мод не найден');const e=await shell.openPath(m.folder);if(e)throw Error(e);return true});
safeHandler('performance:sample',()=>monitor.sample());
safeHandler('profile:save',(id,value)=>{if(!games.some(g=>g.id===id))throw Error('Игра не найдена');const p=normalizeProfile(value);state.profiles=[{gameId:id,...p,updated:new Date().toISOString()},...state.profiles.filter(x=>x.gameId!==id)];persist();return refresh(false)});
safeHandler('library:folder',async id=>{const g=games.find(x=>x.id===id&&x.installed);if(!g)throw Error('Игра не установлена');const folder=g.kind==='local'?path.dirname(g.path):g.path;const error=await shell.openPath(folder);if(error)throw Error(error);return true});
safeHandler('trainer:engine',async kind=>{trainer.checkKind(kind);const r=await dialog.showOpenDialog(win,{title:'Выберите установленный EXE движка трейнеров',properties:['openFile'],filters:[{name:'Windows executable',extensions:['exe']}]});if(r.canceled)return null;const p=trainer.checkFile(r.filePaths[0],'.exe');state.engines=[...state.engines.filter(x=>x.kind!==kind),{kind,path:p}];persist();return refresh(false)});
safeHandler('trainer:table',async id=>{if(!games.some(g=>g.id===id))throw Error('Выберите игру');const r=await dialog.showOpenDialog(win,{title:'Выберите доверенную таблицу Cheat Engine',properties:['openFile'],filters:[{name:'Cheat Engine table',extensions:['ct']}]});if(r.canceled)return null;const p=trainer.checkFile(r.filePaths[0],'.ct');if(!state.tables.some(t=>t.gameId===id&&t.path===p)){state.tables.push({id:randomUUID(),gameId:id,name:path.basename(p),path:p});persist()}return refresh(false)});
safeHandler('trainer:remove',id=>{state.tables=state.tables.filter(t=>t.id!==id);persist();return refresh(false)});
safeHandler('trainer:launch',async(kind,tableId)=>{const engine=state.engines.find(e=>e.kind===trainer.checkKind(kind));if(!engine)throw Error('Сначала настройте движок');const table=tableId?state.tables.find(t=>t.id===tableId):null;if(tableId&&!table)throw Error('Таблица не найдена');const spec=trainer.launchSpec(engine,table);
 const c=await dialog.showMessageBox(win,{type:'warning',title:'Внешний движок',message:table?'Открыть '+table.name+'?':'Запустить внешний инструмент?',detail:'Используйте только в одиночных играх без античита. Таблицы могут содержать исполняемые скрипты — открывайте только доверенные файлы. Nexora не проверяет их код.',buttons:['Отмена','Запустить'],defaultId:0,cancelId:0});
 if(c.response!==1)return false;await new Promise((resolve,reject)=>{const child=spawn(spec.executable,spec.args,{cwd:spec.cwd,detached:true,stdio:'ignore',windowsHide:false});child.once('error',reject);child.once('spawn',()=>{child.unref();resolve()})});return true});

app.whenReady().then(()=>{load();session.defaultSession.setPermissionRequestHandler((_wc,_permission,cb)=>cb(false));win=new BrowserWindow({width:1280,height:850,minWidth:780,minHeight:620,backgroundColor:'#14151c',autoHideMenuBar:true,title:'Nexora',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());win.loadFile('index.html')});
app.on('window-all-closed',()=>app.quit());
