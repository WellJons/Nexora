const {app,BrowserWindow,ipcMain,dialog,shell,session,screen,globalShortcut,desktopCapturer}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const {execFileSync,spawn}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const {configureScratch}=require('./scratch.cjs');
const smokeMode=process.argv.includes('--nexora-ui-smoke')&&process.env.NEXORA_UI_SMOKE==='1';
const profileRoot=smokeMode?fs.mkdtempSync(path.join(require('node:os').tmpdir(),'nexora-ui-smoke-')):path.join(app.getPath('appData'),'Nexora');
fs.mkdirSync(profileRoot,{recursive:true});
app.setPath('userData',profileRoot);
if(!app.requestSingleInstanceLock()){app.quit();process.exit(0)}
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
const updates=require('./updates.cjs').createUpdates(app.getVersion());
const {createTranslation}=require('./translation-window.cjs');
const {settings:translationSettings}=require('./translator.cjs');
const {discoverEpic,epicUri,normalizeProfile,recordLaunch,contained}=require('./library.cjs');
const {discoverGog}=require('./gog.cjs');
const {gameScope,createBridge,numeric}=require('./memory-bridge.cjs');
const bridge=createBridge(path.join(__dirname,'native-bin','Nexora.Memory.exe'));
const playBridge=createBridge(path.join(__dirname,'native-bin','Nexora.Memory.exe'));
const pluginBridge=createBridge(path.join(__dirname,'native-bin','Nexora.Memory.exe'));
const launchBridge=createBridge(path.join(__dirname,'native-bin','Nexora.Memory.exe'));const {createLaunchSession}=require('./launch-session.cjs');let launchSession,discoveryQueue=Promise.resolve();
function discoverLaunchProcesses(scope){const task=discoveryQueue.then(async()=>{try{return await launchBridge.request('list',scope)}finally{launchBridge.close()}});discoveryQueue=task.catch(()=>{});return task}
const {createDemo}=require('./training-demo.cjs');const trainingDemo=createDemo(path.join(__dirname,'native-bin','Nexora.Memory.exe'));
const {createTracker}=require('./game-session.cjs');const {saveRecipe}=require('./trainer-profiles.cjs');let tracker;
let activeGame=null;
const vault=require('./save-vault.cjs');
let saveBusy=false;
async function saveExclusive(fn){if(saveBusy)throw Error('Дождитесь завершения операции с сохранениями');saveBusy=true;try{return await fn()}finally{saveBusy=false}}
let managerBusy=false;
async function exclusive(fn){if(managerBusy)throw Error('Дождитесь завершения другой операции с модами');managerBusy=true;try{return await fn()}finally{managerBusy=false}}
let confirmDialog;
const {createConfirm}=require('./confirm-window.cjs');
let win,state={manual:[],favorites:[],history:[],backups:[],downloads:[],installedMods:[],profiles:[],launchLog:[],playSessions:[],trainerRecipes:[]},games=[];
const config=()=>path.join(app.getPath('userData'),'library.json');
function persist(){const p=config();fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p+'.tmp',JSON.stringify(state,null,2));fs.renameSync(p+'.tmp',p)}
function load(){try{const v=JSON.parse(fs.readFileSync(config(),'utf8'));for(const key of Object.keys(state))if(Array.isArray(v[key]))state[key]=v[key]}catch{}try{const old=JSON.parse(fs.readFileSync(path.join(app.getPath('userData'),'backup-index.json'),'utf8'));if(Array.isArray(old)){const ids=new Set(state.backups.map(b=>b.id));for(const b of old)if(b&&typeof b.id==='string'&&!ids.has(b.id)){state.backups.push(b);ids.add(b.id)}}}catch{}}
function steamRoots(){
 if(process.platform!=='win32')return [];
 const roots=[path.join(process.env['ProgramFiles(x86)']||'C:\\Program Files (x86)','Steam')];
 try{const out=execFileSync('reg.exe',['query','HKCU\\Software\\Valve\\Steam','/v','SteamPath'],{encoding:'utf8',windowsHide:true,timeout:3000});const m=out.match(/REG_SZ\s+(.+)/i);if(m)roots.unshift(m[1].trim())}catch{}
 return [...new Set(roots)];
}
function gogGames(){if(process.platform!=='win32')return [];const result=[];for(const hive of ['HKLM\\SOFTWARE\\GOG.com\\Games','HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games']){try{result.push(...discoverGog(execFileSync('reg.exe',['query',hive,'/s'],{encoding:'utf8',windowsHide:true,timeout:3000,maxBuffer:8*1024*1024})))}catch{}}return result}
function refresh(scan=true){if(scan){const all=[...steamRoots().flatMap(discoverSteam),...gogGames()];if(process.platform==='win32'&&process.env.ProgramData)all.push(...discoverEpic(path.join(process.env.ProgramData,'Epic','EpicGamesLauncher','Data','Manifests')));const manual=state.manual.map(g=>({...g,installed:typeof g.path==='string'&&fs.existsSync(g.path)}));games=mergeGames(all,manual)}return {games,favorites:state.favorites,history:state.history,backups:state.backups,downloads:state.downloads,installedMods:state.installedMods,profiles:state.profiles,launchLog:state.launchLog,trainerRecipes:state.trainerRecipes}}
function safeHandler(name,fn){ipcMain.handle(name,async(e,...args)=>{if(!win||e.sender!==win.webContents||e.senderFrame!==win.webContents.mainFrame)throw Error('Invalid origin');return fn(...args)})}
safeHandler('play:state',()=>tracker.state());
safeHandler('play:processes',async id=>{if(tracker.state().active||tracker.state().busy)throw Error('Завершите текущую сессию');const g=games.find(g=>g.id===id&&g.installed);return playBridge.request('list',gameScope(g))});
safeHandler('play:start',async(id,pid,boost)=>{const g=games.find(g=>g.id===id&&g.installed),scope=gameScope(g);if(typeof boost!=='boolean')throw Error('Неверный режим');if(boost){const c=await confirmDialog.show({type:'question',title:'Игровой режим',message:'Временно повысить приоритет выбранной игры?',detail:'Только Normal → Above Normal, максимум 30 минут. При штатной остановке Nexora возвращает прежний приоритет, если он не изменён извне. FPS может не улучшиться. Службы и другие процессы не изменяются.',buttons:['Отмена','Начать'],defaultId:0,cancelId:0});if(c.response!==1)return null}return tracker.start(g,scope,pid,boost)});
safeHandler('play:stop',()=>tracker.stop());
safeHandler('library:list',refresh);
safeHandler('library:add',async()=>{const r=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'Windows game',extensions:['exe']}]});if(r.canceled)return refresh();const p=r.filePaths[0];if(path.extname(p).toLowerCase()!=='.exe')throw Error('Выберите EXE игры');if(!state.manual.some(g=>g.path===p)){state.manual.push({id:'local:'+randomUUID(),name:path.basename(p,'.exe'),path:p,installed:true,kind:'local'});persist()}return refresh()});
safeHandler('library:favorite',id=>{if(!games.some(g=>g.id===id))throw Error('Игра не найдена');state.favorites=state.favorites.includes(id)?state.favorites.filter(v=>v!==id):[...state.favorites,id];persist();return refresh()});
async function launchGame(id){const g=games.find(g=>g.id===id&&g.installed);if(!g)throw Error('Сначала установите или добавьте игру');if(g.kind==='steam'&&/^steam:\d+$/.test(g.id)){await shell.openExternal('steam://rungameid/'+g.id.slice(6))}else if(g.kind==='epic'){await shell.openExternal(epicUri(g))}else if(g.kind==='gog'||g.kind==='local'&&path.extname(g.path).toLowerCase()==='.exe'){const exe=g.kind==='gog'?contained(g.path,path.relative(g.path,g.exe)):g.path;if(!exe)throw Error('Исполняемый файл игры не найден');await new Promise((resolve,reject)=>{const p=spawn(exe,[],{cwd:path.dirname(exe),detached:true,stdio:'ignore',windowsHide:false});p.once('error',reject);p.once('spawn',()=>{p.unref();resolve()})})}else throw Error('Неизвестный тип игры');state.history=[id,...state.history.filter(v=>v!==id)].slice(0,15);state.launchLog=recordLaunch(state.launchLog,g);persist();return refresh(false)}
safeHandler('library:launch',launchGame);
safeHandler('launch:state',()=>launchSession.state());
safeHandler('launch:start',async(id,shouldLaunch)=>{const session=await launchSession.start(id,shouldLaunch);return {session,data:refresh(false)}});
safeHandler('launch:cancel',()=>launchSession.cancel());
const vaultRoot=()=>path.join(app.getPath('userData'),'backups');
safeHandler('saves:backup',id=>saveExclusive(async()=>{const g=games.find(g=>g.id===id);if(!g)throw Error('Выберите игру');const r=await dialog.showOpenDialog(win,{title:'Выберите папку сохранений (игра должна быть закрыта)',properties:['openDirectory']});if(r.canceled)return null;const target=await vault.snapshot(r.filePaths[0],vaultRoot());state.backups.unshift({id:randomUUID(),game:g.name,gameId:g.id,...target,date:new Date().toISOString()});persist();return refresh(false)}));
safeHandler('saves:export',id=>saveExclusive(async()=>{const b=state.backups.find(v=>v.id===id);if(!b)throw Error('Копия не найдена');const r=await dialog.showOpenDialog(win,{title:'Выберите папку для извлечения (создастся отдельная папка)',properties:['openDirectory']});if(r.canceled)return null;const result=await vault.exportCopy(b,r.filePaths[0]);return {path:result.path}}));
safeHandler('saves:restore',id=>saveExclusive(async()=>{const b=state.backups.find(v=>v.id===id);if(!b||!b.source||!b.fingerprint)throw Error('Для этой копии доступно только извлечение');const r=await confirmDialog.show({type:'warning',title:'Восстановить сохранение',message:'Восстановить '+b.game+'?',detail:'Папка: '+b.source+'\nЗакройте игру и отключите синхронизацию облачных сохранений на время операции. Текущие файлы будут сохранены в соседней резервной папке и не будут удалены.',buttons:['Отмена','Восстановить'],defaultId:0,cancelId:0});if(r.response!==1)return null;const result=await vault.restoreOriginal(b,vaultRoot());state.backups.unshift({id:randomUUID(),game:b.game,gameId:b.gameId,path:result.previous,date:new Date().toISOString(),label:'До восстановления (вне хранилища)'});persist();return {data:refresh(false),previous:result.previous}}));
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
 const confirm=await confirmDialog.show({type:'warning',title:'Установка модов',message:'Установить '+plan.items.length+' файлов?',detail:'Minecraft '+plan.game+' · '+plan.loader+'\n'+plan.items.map(x=>x.file.filename).join('\n')+'\nЗакройте игру. Проверьте версию профиля и доверяйте источнику. Существующие файлы не перезаписываются.',buttons:['Отмена','Установить'],defaultId:0,cancelId:0});if(confirm.response!==1)return null;
 const added=await modPlan.installPlan(mods,plan,r.filePaths[0],state.installedMods);state.installedMods.unshift(...added.map(x=>({...x,id:randomUUID(),date:new Date().toISOString()})));persist();return refresh(false);
}));
safeHandler('manager:check-update',async(id,game,loader)=>{const m=state.installedMods.find(x=>x.id===id);if(!m)throw Error('Мод не найден');return modPlan.checkUpdate(mods,m,game,loader)});
safeHandler('thunder:search',(game,q,sort,page)=>thunder.search(game,q,sort,page));
safeHandler('thunder:details',(game,id)=>thunder.details(game,id));
safeHandler('thunder:download',async(game,id,version)=>{
 if(thunderBusy)throw Error('Уже выполняется загрузка');thunderBusy=true;
 try{const p=await thunder.details(game,id);if(!p.versions.some(v=>v.version===version))throw Error('Версия не найдена');
 const r=await dialog.showSaveDialog(win,{title:'Сохранить архив мода',defaultPath:path.join(app.getPath('downloads'),p.id+'-'+version+'.zip'),filters:[{name:'ZIP',extensions:['zip']}]});if(r.canceled)return null;
 const result=await thunder.download(game,id,version,r.filePath);state.downloads.unshift({id:randomUUID(),path:r.filePath,provider:'Thunderstore',project:id,version,game,dependencies:p.versions.find(v=>v.version===version)?.dependencies||[],date:new Date().toISOString(),...result});state.downloads=state.downloads.slice(0,100);persist();return refresh(false);
 }finally{thunderBusy=false}
});
safeHandler('mods:show',id=>{const d=state.downloads.find(v=>v.id===id);if(!d)throw Error('Загрузка не найдена');shell.showItemInFolder(d.path);return true});
safeHandler('manager:list',()=>exclusive(async()=>{const rows=[];for(const m of state.installedMods){let status;try{status=m.provider==='Thunderstore'?await pluginBridge.request('plugin-status',{folder:m.folder,package:m.project}):await manager.status(m)}catch{status='conflict'}rows.push({...m,status})}return rows}));

safeHandler('manager:install',id=>exclusive(async()=>{
 const d=state.downloads.find(x=>x.id===id);if(!d)throw Error('Загрузка не найдена');
 if(d.provider==='Thunderstore'){
  const pick=await dialog.showOpenDialog(win,{title:'Выберите существующую папку BepInEx нужной игры',properties:['openDirectory']});if(pick.canceled)return null;
  const folder=fs.realpathSync(pick.filePaths[0]);const answer=await confirmDialog.show({type:'warning',title:'Установка BepInEx-плагина',message:d.project+' '+d.version,detail:'Закройте игру. Уже установленный BepInEx обязателен. Поддерживаются обычные плагины; загрузчики и patchers не устанавливаются. Проверьте совместимость и установите необходимые зависимости вручную: '+(d.dependencies?.join(', ')||'нет данных / не заявлены')+'\nМоды содержат исполняемый код. Nexora не проверяет его безопасность. Файлы игры не перезаписываются.',buttons:['Отмена','Установить'],defaultId:0,cancelId:0});if(answer.response!==1)return null;
  const installed=await pluginBridge.request('plugin-install',{archive:d.path,sha256:d.sha256,size:d.size,folder,package:d.project});
  state.installedMods.unshift({...installed,id:randomUUID(),provider:'Thunderstore',project:d.project,name:d.project,version:d.version,game:d.game,date:new Date().toISOString()});persist();return refresh(false);
 }
 if(d.provider!=='Modrinth')throw Error('Неизвестный источник модов');
 const result=await dialog.showOpenDialog(win,{title:'Выберите папку mods нужного профиля Minecraft',properties:['openDirectory']});
 if(result.canceled)return null;
 const confirmation=await confirmDialog.show({type:'warning',buttons:['Отмена','Установить'],defaultId:0,cancelId:0,title:'Установка мода',message:d.name,detail:'Папка: '+result.filePaths[0]+'\nЗакройте Minecraft. Устанавливайте только доверенные моды. Убедитесь, что версия игры, загрузчик и зависимости подходят. Nexora не проверяет мод на вредоносный код.'});
 if(confirmation.response!==1)return null;
 const installed=await manager.install(d,result.filePaths[0]);
 state.installedMods.unshift({...installed,id:randomUUID(),project:d.project,version:d.version,date:new Date().toISOString()});
 persist();return refresh();
}));
safeHandler('manager:toggle',(id,enabled)=>exclusive(async()=>{
 if(typeof enabled!=='boolean')throw Error('Некорректное действие');
 const m=state.installedMods.find(x=>x.id===id);if(!m)throw Error('Мод не управляется Nexora');
 const confirm=await confirmDialog.show({type:'question',buttons:['Отмена',enabled?'Включить':'Отключить'],defaultId:0,cancelId:0,message:m.name,detail:m.provider==='Thunderstore'?'Закройте игру. Папка плагина будет перемещена без перезаписи других модов.':'Перед изменением закройте Minecraft. Файл будет переименован без перезаписи других модов.'});
 if(confirm.response!==1)return null;
 if(m.provider==='Thunderstore')await pluginBridge.request('plugin-toggle',{folder:m.folder,package:m.project,enabled});else await manager.toggle(m,enabled);return refresh(false);
}));
safeHandler('manager:folder',async id=>{const m=state.installedMods.find(x=>x.id===id);if(!m)throw Error('Мод не найден');const e=await shell.openPath(m.folder);if(e)throw Error(e);return true});
safeHandler('performance:sample',()=>monitor.sample());
safeHandler('profile:save',(id,value)=>{if(!games.some(g=>g.id===id))throw Error('Игра не найдена');const p=normalizeProfile(value);state.profiles=[{gameId:id,...p,updated:new Date().toISOString()},...state.profiles.filter(x=>x.gameId!==id)];persist();return refresh(false)});
safeHandler('library:folder',async id=>{const g=games.find(x=>x.id===id&&x.installed);if(!g)throw Error('Игра не установлена');const folder=g.kind==='local'?path.dirname(g.path):g.path;const error=await shell.openPath(folder);if(error)throw Error(error);return true});
function scopeOf(id){return gameScope(games.find(g=>g.id===id))}
function attached(){if(activeGame===null)throw Error('Выберите запущенную игру');}
safeHandler('demo:state',()=>trainingDemo.state());
safeHandler('demo:action',op=>{if(!['start','stop','status','earn','hit','heal','gold'].includes(op))throw Error('Неверная команда арены');return trainingDemo.action(op)});
safeHandler('trainer:save-recipe',(gameId,value)=>{if(!games.some(g=>g.id===gameId))throw Error('Игра не найдена');state.trainerRecipes=saveRecipe(state.trainerRecipes,gameId,value);persist();return refresh(false)});
safeHandler('trainer:delete-recipe',(gameId,id)=>{state.trainerRecipes=state.trainerRecipes.filter(x=>!(x.gameId===gameId&&x.id===id));persist();return refresh(false)});
safeHandler('memory:list',id=>bridge.request('list',scopeOf(id)));
safeHandler('memory:attach',async(id,pid)=>{
 if(!Number.isSafeInteger(pid)||pid<=4)throw Error('Некорректный процесс');
 const scope=scopeOf(id);
 const c=await confirmDialog.show({type:'warning',title:'Редактор игровых значений',message:'Открыть выбранную одиночную игру?',detail:'Используйте только в собственной одиночной игре без античита. Изменение памяти может привести к сбою или потере прогресса. Сделайте резервную копию.',buttons:['Отмена','Продолжить'],defaultId:0,cancelId:0});
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
safeHandler('translation:model-install',async(pack='q8')=>{packFiles(pack);if(translation.state().running)throw Error('Остановите перевод перед установкой');const answer=await confirmDialog.show({type:'question',title:'Локальный языковой пакет',message:'Скачать модель английский → русский?',detail:(pack==='m2m'?'Около 650 МБ, M2M100. ':pack==='fp32'?'Около 450 МБ, полные веса. ':'Около 250 МБ, квантованные веса. ')+'Загрузка выполняется один раз. Текст игры не отправляется. После скачивания перевод работает без API-ключей и интернета.',buttons:['Отмена','Скачать'],defaultId:0,cancelId:0});return answer.response===1?localModel.install(pack):localModel.state()});
safeHandler('translation:model-cancel',()=>localModel.cancel());
safeHandler('translation:model-remove',async pack=>{packFiles(pack);if(translation.state().running)throw Error('Остановите перевод');const answer=await confirmDialog.show({type:'question',title:'Удаление языкового пакета',message:'Удалить выбранный пакет?',detail:'Удаляются только известные файлы выбранной модели. Другие модели, моды и сохранения остаются. Пакет можно скачать заново.',buttons:['Отмена','Удалить'],defaultId:0,cancelId:0});if(answer.response!==1)return localModel.state();if(translation.state().running)throw Error('Остановите перевод');return localModel.remove(pack,[...state.downloads.map(x=>x.path),...state.installedMods.map(x=>x.folder),...state.manual.map(x=>x.path),...state.backups.map(x=>x.source),...state.backups.map(x=>x.path)])});
safeHandler('updates:check',()=>updates.check());
safeHandler('updates:open',()=>shell.openExternal(updates.page()));

safeHandler('translation:start',async value=>{
 const config=translationSettings(value);
 const detail=['ocr','local'].includes(config.provider)?'Распознавание и выбранная локальная обработка выполняются без отправки текста или изображений.':'Распознанный английский текст выбранного окна или области будет передаваться сервису '+(config.provider==='deepl'?'DeepL':'MyMemory')+'. Изображения не отправляются. Не оставляйте в области личные данные; сервис имеет собственные правила и лимиты. В режиме окна захват приостанавливается при переключении; в режиме области следит за экраном. Не захватывайте личные данные.';
 const c=await confirmDialog.show({type:'question',title:'Экранный перевод',message:config.mode==='window'?'Начать перевод выбранного игрового окна?':'Начать захват выбранной области экрана?',detail:detail+(config.provider==='local'&&config.mode==='window'?'\nСессия работает до остановки или закрытия игрового окна.':'\nСессия ограничена 30 минутами.')+' Остановить можно из Nexora.',buttons:['Отмена','Начать'],defaultId:0,cancelId:0});
 if(c.response!==1)return null;if(localModel.state().removing||localModel.state().installing)throw Error('Дождитесь завершения операции с моделью');return translation.start(config);
});
safeHandler('translation:stop',()=>translation.stop());
let quitting=false;
app.on('before-quit',e=>{if(!quitting&&tracker?.state().active){e.preventDefault();quitting=true;const deadline=setTimeout(()=>app.quit(),6000);tracker.shutdown().catch(()=>{}).finally(()=>{clearTimeout(deadline);app.quit()});return}confirmDialog?.close();trainingDemo.close();launchSession?.close();launchBridge.close();bridge.close();pluginBridge.close();overlay?.close();translation?.stop();localModel?.cancel();localModel?.close()});

app.on('second-instance',()=>{if(win&&!win.isDestroyed()){if(win.isMinimized())win.restore();win.show();win.focus()}});
app.whenReady().then(()=>{configureScratch(app.getPath('userData'));load();launchSession=createLaunchSession({findGame:id=>games.find(g=>g.id===id&&g.installed),scopeOf:gameScope,launch:launchGame,list:discoverLaunchProcesses,send:value=>{if(win&&!win.isDestroyed())win.webContents.send('launch:changed',value)}});tracker=createTracker({bridge:playBridge,monitor,getHistory:()=>state.playSessions,saveHistory:rows=>{state.playSessions=rows;persist()},send:value=>{if(win&&!win.isDestroyed())win.webContents.send('play:changed',value)}});session.defaultSession.setPermissionRequestHandler((_wc,_permission,cb)=>cb(false));win=new BrowserWindow({width:1280,height:850,minWidth:780,minHeight:620,backgroundColor:'#101117',autoHideMenuBar:true,title:'Nexora',...(process.platform==='win32'?{titleBarStyle:'hidden',titleBarOverlay:{color:'#15141e',symbolColor:'#d1c9e8',height:36}}:{}),webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});confirmDialog=createConfirm({BrowserWindow,ipcMain,parent:win,dir:__dirname});win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());overlay=createOverlay({BrowserWindow,screen,globalShortcut,ipcMain,monitor,dir:__dirname,onChange:value=>{if(win&&!win.isDestroyed())win.webContents.send('hud:changed',value)}});localModel=createLocalModel(path.join(app.getPath('userData'),'translation-models'),value=>{if(win&&!win.isDestroyed())win.webContents.send('translation:model-changed',value)});translation=createTranslation({localModel,BrowserWindow,screen,desktopCapturer,globalShortcut,ipcMain,main:win,dir:__dirname,onChange:value=>{if(win&&!win.isDestroyed())win.webContents.send('translation:changed',value)}});win.on('closed',()=>{overlay.close();translation.stop();app.quit()});if(smokeMode)require('./ui-smoke.cjs').runSmoke(win,app,profileRoot,confirmDialog);win.loadFile('index.html')});
app.on('window-all-closed',()=>app.quit());
