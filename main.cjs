const {app,BrowserWindow,ipcMain,dialog,shell,session,screen,globalShortcut,desktopCapturer}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const {execFileSync,spawn}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const {discoverSteam,mergeGames}=require('./core.cjs');
const mods=require('./mods.cjs');
const manager=require('./manager.cjs');
const modPlan=require('./mod-plan.cjs');
const thunder=require('./thunder.cjs').createThunder();
let thunderBusy=false;
let pendingModPlan=null;
const {makeMonitor}=require('./performance.cjs');
const monitor=makeMonitor(require('systeminformation'));
const {createOverlay}=require('./overlay.cjs');
let overlay,translation,localModel;
const {createLocalModel,packFiles}=require('./local-model.cjs');
const {createTranslation}=require('./translation-window.cjs');
const {settings:translationSettings}=require('./translator.cjs');
const {discoverEpic,epicUri,normalizeProfile,recordLaunch,contained}=require('./library.cjs');
const {discoverGog}=require('./gog.cjs');
const {gameScope,createBridge,numeric}=require('./memory-bridge.cjs');
const bridge=createBridge(path.join(__dirname,'native-bin','Nexora.Memory.exe'));
let activeGame=null;
const vault=require('./save-vault.cjs');
let saveBusy=false;
async function saveExclusive(fn){if(saveBusy)throw Error('Дождитесь завершения операции с сохранениями');saveBusy=true;try{return await fn()}finally{saveBusy=false}}
let managerBusy=false;
async function exclusive(fn){if(managerBusy)throw Error('Дождитесь завершения другой операции с модами');managerBusy=true;try{return await fn()}finally{managerBusy=false}}
let win,state={manual:[],favorites:[],history:[],backups:[],downloads:[],installedMods:[],profiles:[],launchLog:[]},games=[];
const config=()=>path.join(app.getPath('userData'),'library.json');
function persist(){const p=config();fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p+'.tmp',JSON.stringify(state,null,2));fs.renameSync(p+'.tmp',p)}
function load(){try{const v=JSON.parse(fs.readFileSync(config(),'utf8'));for(const key of Object.keys(state))if(Array.isArray(v[key]))state[key]=v[key]}catch{}}
function steamRoots(){
 if(process.platform!=='win32')return [];
 const roots=[path.join(process.env['ProgramFiles(x86)']||'C:\\Program Files (x86)','Steam')];
 try{const out=execFileSync('reg.exe',['query','HKCU\\Software\\Valve\\Steam','/v','SteamPath'],{encoding:'utf8',windowsHide:true,timeout:3000});const m=out.match(/REG_SZ\s+(.+)/i);if(m)roots.unshift(m[1].trim())}catch{}
 return [...new Set(roots)];
}
function gogGames(){if(process.platform!=='win32')return [];const result=[];for(const hive of ['HKLM\\SOFTWARE\\GOG.com\\Games','HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games']){try{result.push(...discoverGog(execFileSync('reg.exe',['query',hive,'/s'],{encoding:'utf8',windowsHide:true,timeout:3000,maxBuffer:8*1024*1024})))}catch{}}return result}
function refresh(scan=true){if(scan){const all=[...steamRoots().flatMap(discoverSteam),...gogGames()];if(process.platform==='win32'&&process.env.ProgramData)all.push(...discoverEpic(path.join(process.env.ProgramData,'Epic','EpicGamesLauncher','Data','Manifests')));const manual=state.manual.map(g=>({...g,installed:typeof g.path==='string'&&fs.existsSync(g.path)}));games=mergeGames(all,manual)}return {games,favorites:state.favorites,history:state.history,backups:state.backups,downloads:state.downloads,installedMods:state.installedMods,profiles:state.profiles,launchLog:state.launchLog}}
function safeHandler(name,fn){ipcMain.handle(name,async(e,...args)=>{if(!win||e.sender!==win.webContents||e.senderFrame!==win.webContents.mainFrame)throw Error('Invalid origin');return fn(...args)})}
safeHandler('library:list',refresh);
safeHandler('library:add',async()=>{const r=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'Windows game',extensions:['exe']}]});if(r.canceled)return refresh();const p=r.filePaths[0];if(path.extname(p).toLowerCase()!=='.exe')throw Error('Выберите EXE игры');if(!state.manual.some(g=>g.path===p)){state.manual.push({id:'local:'+randomUUID(),name:path.basename(p,'.exe'),path:p,installed:true,kind:'local'});persist()}return refresh()});
safeHandler('library:favorite',id=>{if(!games.some(g=>g.id===id))throw Error('Игра не найдена');state.favorites=state.favorites.includes(id)?state.favorites.filter(v=>v!==id):[...state.favorites,id];persist();return refresh()});
safeHandler('library:launch',async id=>{const g=games.find(g=>g.id===id&&g.installed);if(!g)throw Error('Сначала установите или добавьте игру');if(g.kind==='steam'&&/^steam:\d+$/.test(g.id)){await shell.openExternal('steam://rungameid/'+g.id.slice(6))}else if(g.kind==='epic'){await shell.openExternal(epicUri(g))}else if(g.kind==='gog'||g.kind==='local'&&path.extname(g.path).toLowerCase()==='.exe'){const exe=g.kind==='gog'?contained(g.path,path.relative(g.path,g.exe)):g.path;if(!exe)throw Error('Исполняемый файл игры не найден');await new Promise((resolve,reject)=>{const p=spawn(exe,[],{cwd:path.dirname(exe),detached:true,stdio:'ignore',windowsHide:false});p.once('error',reject);p.once('spawn',()=>{p.unref();resolve()})})}else throw Error('Неизвестный тип игры');state.history=[id,...state.history.filter(v=>v!==id)].slice(0,15);state.launchLog=recordLaunch(state.launchLog,g);persist();return refresh(false)});
const vaultRoot=()=>path.join(app.getPath('userData'),'backups');
safeHandler('saves:backup',id=>saveExclusive(async()=>{const g=games.find(g=>g.id===id);if(!g)throw Error('Выберите игру');const r=await dialog.showOpenDialog(win,{title:'Выберите папку сохранений (игра должна быть закрыта)',properties:['openDirectory']});if(r.canceled)return null;const target=await vault.snapshot(r.filePaths[0],vaultRoot());state.backups.unshift({id:randomUUID(),game:g.name,gameId:g.id,...target,date:new Date().toISOString()});persist();return refresh(false)}));
safeHandler('saves:export',id=>saveExclusive(async()=>{const b=state.backups.find(v=>v.id===id);if(!b)throw Error('Копия не найдена');const r=await dialog.showOpenDialog(win,{title:'Выберите папку для извлечения (создастся отдельная папка)',properties:['openDirectory']});if(r.canceled)return null;const result=await vault.exportCopy(b,r.filePaths[0]);return {path:result.path}}));
safeHandler('saves:restore',id=>saveExclusive(async()=>{const b=state.backups.find(v=>v.id===id);if(!b||!b.source||!b.fingerprint)throw Error('Для этой копии доступно только извлечение');const r=await dialog.showMessageBox(win,{type:'warning',title:'Восстановить сохранение',message:'Восстановить '+b.game+'?',detail:'Папка: '+b.source+'\nЗакройте игру и отключите синхронизацию облачных сохранений на время операции. Текущие файлы будут сохранены в соседней резервной папке и не будут удалены.',buttons:['Отмена','Восстановить'],defaultId:0,cancelId:0});if(r.response!==1)return null;const result=await vault.restoreOriginal(b,vaultRoot());state.backups.unshift({id:randomUUID(),game:b.game,gameId:b.gameId,path:result.previous,date:new Date().toISOString(),label:'До восстановления (вне хранилища)'});persist();return {data:refresh(false),previous:result.previous}}));
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
safeHandler('mods:plan',async request=>{pendingModPlan=null;const plan=await modPlan.resolvePlan(mods,request);const token=randomUUID();pendingModPlan={token,plan,expires:Date.now()+600000};return {token,...modPlan.preview(plan)}});
safeHandler('mods:install-plan',token=>exclusive(async()=>{
 if(!pendingModPlan||pendingModPlan.token!==token||Date.now()>pendingModPlan.expires)throw Error('План устарел; сформируйте его заново');
 const {plan}=pendingModPlan;pendingModPlan=null;
 const r=await dialog.showOpenDialog(win,{title:'Выберите папку mods правильного профиля Minecraft',properties:['openDirectory']});if(r.canceled)return null;
 const confirm=await dialog.showMessageBox(win,{type:'warning',title:'Установка модов',message:'Установить '+plan.items.length+' файлов?',detail:'Minecraft '+plan.game+' · '+plan.loader+'\n'+plan.items.map(x=>x.file.filename).join('\n')+'\nЗакройте игру. Проверьте версию профиля и доверяйте источнику. Существующие файлы не перезаписываются.',buttons:['Отмена','Установить'],defaultId:0,cancelId:0});if(confirm.response!==1)return null;
 const added=await modPlan.installPlan(mods,plan,r.filePaths[0],state.installedMods);state.installedMods.unshift(...added.map(x=>({...x,id:randomUUID(),date:new Date().toISOString()})));persist();return refresh(false);
}));
safeHandler('manager:check-update',async(id,game,loader)=>{const m=state.installedMods.find(x=>x.id===id);if(!m)throw Error('Мод не найден');return modPlan.checkUpdate(mods,m,game,loader)});
safeHandler('thunder:search',(game,q,sort,page)=>thunder.search(game,q,sort,page));
safeHandler('thunder:details',(game,id)=>thunder.details(game,id));
safeHandler('thunder:download',async(game,id,version)=>{
 if(thunderBusy)throw Error('Уже выполняется загрузка');thunderBusy=true;
 try{const p=await thunder.details(game,id);if(!p.versions.some(v=>v.version===version))throw Error('Версия не найдена');
 const r=await dialog.showSaveDialog(win,{title:'Сохранить архив мода',defaultPath:path.join(app.getPath('downloads'),p.id+'-'+version+'.zip'),filters:[{name:'ZIP',extensions:['zip']}]});if(r.canceled)return null;
 const result=await thunder.download(game,id,version,r.filePath);state.downloads.unshift({id:randomUUID(),path:r.filePath,provider:'Thunderstore',project:id,version,date:new Date().toISOString(),...result});state.downloads=state.downloads.slice(0,100);persist();return refresh(false);
 }finally{thunderBusy=false}
});
safeHandler('mods:show',id=>{const d=state.downloads.find(v=>v.id===id);if(!d)throw Error('Загрузка не найдена');shell.showItemInFolder(d.path);return true});
safeHandler('manager:list',async()=>Promise.all(state.installedMods.map(async m=>({...m,status:await manager.status(m)}))));
safeHandler('manager:install',id=>exclusive(async()=>{
 const d=state.downloads.find(x=>x.id===id);if(!d||d.provider!=='Modrinth')throw Error('Автоустановка доступна только для JAR-файлов Modrinth');
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
function scopeOf(id){return gameScope(games.find(g=>g.id===id))}
function attached(){if(activeGame===null)throw Error('Выберите запущенную игру');}
safeHandler('memory:list',id=>bridge.request('list',scopeOf(id)));
safeHandler('memory:attach',async(id,pid)=>{
 if(!Number.isSafeInteger(pid)||pid<=4)throw Error('Некорректный процесс');
 const scope=scopeOf(id);
 const c=await dialog.showMessageBox(win,{type:'warning',title:'Редактор игровых значений',message:'Открыть выбранную одиночную игру?',detail:'Используйте только в собственной одиночной игре без античита. Изменение памяти может привести к сбою или потере прогресса. Сделайте резервную копию.',buttons:['Отмена','Продолжить'],defaultId:0,cancelId:0});
 if(c.response!==1)return null;
 activeGame=null;bridge.close();const result=await bridge.request('attach',{...scope,pid});activeGame=id;return {...result,gameId:id};
});
safeHandler('memory:scan',(kind,value)=>{attached();if(!['int32','float32'].includes(kind))throw Error('Неизвестный тип');return bridge.request('scan',{kind,value:numeric(value)})});
safeHandler('memory:refine',value=>{attached();return bridge.request('refine',{value:numeric(value)})});
safeHandler('memory:results',()=>{attached();return bridge.request('results')});
safeHandler('memory:write',(address,value)=>{attached();if(typeof address!=='string'||!/^[0-9A-F]{1,16}$/.test(address))throw Error('Неверный адрес');return bridge.request('write',{address,value:numeric(value)})});
function addressOf(v){if(typeof v!=='string'||!/^[0-9A-F]{1,16}$/.test(v))throw Error('Неверный адрес');return v}
safeHandler('memory:pin',(address,name)=>{attached();if(typeof name!=='string'||!name.trim()||name.length>70)throw Error('Введите название до 70 символов');return bridge.request('pin',{address:addressOf(address),name:name.trim()})});
safeHandler('memory:watch-set',(address,value,freeze)=>{attached();if(typeof freeze!=='boolean')throw Error('Некорректная операция');return bridge.request('watch-set',{address:addressOf(address),value:numeric(value),freeze})});
safeHandler('memory:watch-stop',address=>{attached();return bridge.request('watch-stop',{address:addressOf(address)})});
safeHandler('memory:watch-remove',address=>{attached();return bridge.request('watch-remove',{address:addressOf(address)})});
safeHandler('memory:stop-all',()=>{attached();return bridge.request('stop-all')});
safeHandler('memory:detach',()=>{activeGame=null;bridge.close();return true});
safeHandler('hud:state',()=>overlay.state());
safeHandler('hud:configure',v=>overlay.configure(v));
safeHandler('hud:toggle',()=>overlay.toggle());
safeHandler('translation:displays',()=>translation.displays());
safeHandler('translation:windows',()=>translation.windows());
safeHandler('translation:state',()=>translation.state());
safeHandler('translation:model-state',()=>localModel.state());
safeHandler('translation:model-install',async(pack='q8')=>{packFiles(pack);if(translation.state().running)throw Error('Остановите перевод перед установкой');const answer=await dialog.showMessageBox(win,{type:'question',title:'Локальный языковой пакет',message:'Скачать модель английский → русский?',detail:(pack==='fp32'?'Около 450 МБ, полные веса. ':'Около 250 МБ, квантованные веса. ')+'Загрузка выполняется один раз. Текст игры не отправляется. После скачивания перевод работает без API-ключей и интернета.',buttons:['Отмена','Скачать'],defaultId:0,cancelId:0});return answer.response===1?localModel.install(pack):localModel.state()});
safeHandler('translation:model-cancel',()=>localModel.cancel());
safeHandler('translation:start',async value=>{
 const config=translationSettings(value);
 const detail=['ocr','local'].includes(config.provider)?'Распознавание и выбранная локальная обработка выполняются без отправки текста или изображений.':'Распознанный английский текст выбранного окна или области будет передаваться сервису '+(config.provider==='deepl'?'DeepL':'MyMemory')+'. Изображения не отправляются. Не оставляйте в области личные данные; сервис имеет собственные правила и лимиты. В режиме окна захват приостанавливается при переключении; в режиме области следит за экраном. Не захватывайте личные данные.';
 const c=await dialog.showMessageBox(win,{type:'question',title:'Экранный перевод',message:config.mode==='window'?'Начать перевод выбранного игрового окна?':'Начать захват выбранной области экрана?',detail:detail+(config.provider==='local'&&config.mode==='window'?'\nСессия работает до остановки или закрытия игрового окна.':'\nСессия ограничена 30 минутами.')+' Остановить можно из Nexora.',buttons:['Отмена','Начать'],defaultId:0,cancelId:0});
 if(c.response!==1)return null;return translation.start(config);
});
safeHandler('translation:stop',()=>translation.stop());
app.on('before-quit',()=>{bridge.close();overlay?.close();translation?.stop();localModel?.cancel();localModel?.close()});
app.whenReady().then(()=>{load();session.defaultSession.setPermissionRequestHandler((_wc,_permission,cb)=>cb(false));win=new BrowserWindow({width:1280,height:850,minWidth:780,minHeight:620,backgroundColor:'#14151c',autoHideMenuBar:true,title:'Nexora',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());overlay=createOverlay({BrowserWindow,screen,globalShortcut,ipcMain,monitor,dir:__dirname,onChange:value=>{if(win&&!win.isDestroyed())win.webContents.send('hud:changed',value)}});localModel=createLocalModel(path.join(app.getPath('userData'),'translation-models'),value=>{if(win&&!win.isDestroyed())win.webContents.send('translation:model-changed',value)});translation=createTranslation({localModel,BrowserWindow,screen,desktopCapturer,globalShortcut,ipcMain,main:win,dir:__dirname,onChange:value=>{if(win&&!win.isDestroyed())win.webContents.send('translation:changed',value)}});win.on('closed',()=>{overlay.close();translation.stop();app.quit()});win.loadFile('index.html')});
app.on('window-all-closed',()=>app.quit());
