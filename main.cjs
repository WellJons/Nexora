const {app,BrowserWindow,ipcMain,dialog,shell,session,screen,globalShortcut,desktopCapturer,clipboard}=require('electron');
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
const {createInstaller}=require('./update-install.cjs');let updater,updateLaunching=false;
const {commandCatalog,lookupCommand}=require('./game-commands.cjs');
const gameProfiles=require('./game-profiles.cjs'),adapters=require('./adapter-registry.cjs');
const {createDiscovery}=require('./trainer-discovery.cjs');let trainerDiscovery;const externalTools=require('./external-trainers.cjs');let external;
const gameItems=require('./game-items.cjs'),rcon=require('./local-rcon.cjs');let localRcon=null,rconBusy=false,queuedConsole=null,consoleBusy=false;
const {createTranslation}=require('./translation-window.cjs');
const {settings:translationSettings}=require('./translator.cjs');
const {discoverEpic,epicUri,normalizeProfile,recordLaunch,contained}=require('./library.cjs');
const {discoverGog}=require('./gog.cjs');
const {gameScope,createBridge,numeric}=require('./memory-bridge.cjs');
const bridge=createBridge(path.join(__dirname,'native-bin','Nexora.Memory.exe'));
const playBridge=createBridge(path.join(__dirname,'native-bin','Nexora.Memory.exe'));
const pluginBridge=createBridge(path.join(__dirname,'native-bin','Nexora.Memory.exe'));
const consoleBridge=createBridge(path.join(__dirname,'native-bin','Nexora.Memory.exe'));
const gk2Bridge=createBridge(path.join(__dirname,'native-bin','Nexora.Memory.exe'));let gk2Active=false,gk2Busy=false,gk2GameId=null,gk2Pid=null,gk2ItemIds=[],itemLabelsBusy=false;const itemLabels=require('./item-localize.cjs').createLabels({translate:(text,signal)=>localModel.translate(text,signal,'lite'),enabled:()=>!!localModel&&localModel.isReady('lite')&&!translation?.state().running});const {createAutoTrainer}=require('./auto-trainer.cjs');let autoTrainer;
const launchBridge=createBridge(path.join(__dirname,'native-bin','Nexora.Memory.exe'));const {createLaunchSession}=require('./launch-session.cjs');let launchSession,discoveryQueue=Promise.resolve();
function discoverLaunchProcesses(scope){const task=discoveryQueue.then(async()=>{try{return await launchBridge.request('list',scope)}finally{launchBridge.close()}});discoveryQueue=task.catch(()=>{});return task}
const {createTracker}=require('./game-session.cjs');const {saveRecipe}=require('./trainer-profiles.cjs');let tracker;
let activeGame=null;
const vault=require('./save-vault.cjs');
let saveBusy=false,gk2Opened=null;const saveSlots=new Map(),openedSaves=new Map();
function saveRoot(engine){if(engine==='gk2')return path.join(require('node:os').homedir(),'AppData','LocalLow','Lazy Bear Games','Graveyard Keeper 2');if(engine==='stardew')return path.join(app.getPath('appData'),'StardewValley','Saves');throw Error('Неизвестный редактор')}
function adapterWorker(engine,op,args){saveRoot(engine);return new Promise((resolve,reject)=>{const worker=new (require('node:worker_threads').Worker)(path.join(__dirname,'save-adapter-worker.cjs'),{workerData:{engine,op,args},resourceLimits:{maxOldGenerationSizeMb:512}});let done=false;const timer=setTimeout(()=>finish(Error('Время операции истекло')),45000);function finish(e,v){if(done)return;done=true;clearTimeout(timer);void worker.terminate();e?reject(e):resolve(v)}worker.once('message',v=>v.ok?finish(null,v.result):finish(Error(v.error)));worker.once('error',e=>finish(e));worker.once('exit',()=>finish(Error('Редактор остановлен')))})}
function gk2Run(op,args){return new Promise((resolve,reject)=>{const worker=new (require('node:worker_threads').Worker)(path.join(__dirname,'gk2-worker.cjs'),{workerData:{op,args},resourceLimits:{maxOldGenerationSizeMb:384}});let done=false;const timer=setTimeout(()=>finish(Error('Редактор не ответил')),45000);function finish(e,v){if(done)return;done=true;clearTimeout(timer);void worker.terminate();e?reject(e):resolve(v)}worker.once('message',v=>v.ok?finish(null,v.result):finish(Error(v.error)));worker.once('error',e=>finish(e));worker.once('exit',()=>finish(Error('Редактор остановлен')))})}
async function saveExclusive(fn){if(saveBusy)throw Error('Дождитесь завершения операции с сохранениями');saveBusy=true;try{return await fn()}finally{saveBusy=false}}
let managerBusy=false;
async function exclusive(fn){if(managerBusy)throw Error('Дождитесь завершения другой операции с модами');managerBusy=true;try{return await fn()}finally{managerBusy=false}}
let confirmDialog;
const {createConfirm}=require('./confirm-window.cjs');
let win,state={manual:[],favorites:[],history:[],backups:[],downloads:[],installedMods:[],profiles:[],launchLog:[],playSessions:[],trainerRecipes:[],externalTrainers:[]},games=[];
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
function refresh(scan=true){if(scan){const all=[...steamRoots().flatMap(discoverSteam),...gogGames()];if(process.platform==='win32'&&process.env.ProgramData)all.push(...discoverEpic(path.join(process.env.ProgramData,'Epic','EpicGamesLauncher','Data','Manifests')));const manual=state.manual.map(g=>({...g,installed:typeof g.path==='string'&&fs.existsSync(g.path)}));games=mergeGames(all,manual,gameProfiles.libraryEntries())}return {games:games.map(g=>({...g,trainerProfile:gameProfiles.match(g)})),favorites:state.favorites,history:state.history,backups:state.backups,downloads:state.downloads,installedMods:state.installedMods,profiles:state.profiles,launchLog:state.launchLog,trainerRecipes:state.trainerRecipes}}
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
safeHandler('launch:start',async(id,shouldLaunch,automatic=false)=>{if(typeof automatic!=='boolean')throw Error('Неверный режим запуска');if(['checking','launching','waiting'].includes(launchSession.state().phase))throw Error('Сначала завершите ожидание');if(autoTrainer.pending()||autoTrainer.state().gameId&&autoTrainer.state().gameId!==id)stopAutoTrainer();if(automatic&&!smokeMode&&!gk2Active&&!gk2Busy&&activeGame===null)autoTrainer.arm(id);try{const session=await launchSession.start(id,shouldLaunch);autoTrainer.observe(session);return {session,data:refresh(false)}}catch(e){stopAutoTrainer();throw e}});
safeHandler('trainer:auto-state',()=>autoTrainer.state());
safeHandler('trainer:auto-stop',()=>stopAutoTrainer());
safeHandler('trainer:discover',async(id,online=true,force=false)=>{if(typeof online!=='boolean'||typeof force!=='boolean')throw Error('Неверные настройки поиска');const game=games.find(g=>g.id===id);if(!game)throw Error('Игра не найдена');const result=await trainerDiscovery.prepare(game,{online:online&&!smokeMode,force});return {result,data:refresh(false)}});
safeHandler('trainer:preview',(id,file)=>{if(smokeMode)throw Error('Сетевой просмотр отключён в CI');return trainerDiscovery.preview(id,file)});
safeHandler('external:info',id=>external.info(id));
safeHandler('external:catalog',async id=>{const g=games.find(x=>x.id===id&&x.installed),p=externalTools.packageFor(g);if(!p)throw Error('Нет подходящего пакета');const a=await confirmDialog.show({title:'Сторонний трейнер',message:'Разрешить автоматический запуск '+p.title+' '+p.version+'?',detail:'Источник: '+p.source+'\nSHA-256: '+p.sha256+'\nЭто сторонний EXE, не проверенный на безопасность или совместимость с вашей версией игры. Только для локальной одиночной игры. Nexora скачает только эту версию, проверит хэш и запустит её при следующих запусках игры. Интерфейс будет в отдельном окне. Не запускайте от администратора. Сделайте копию сохранения.',buttons:['Отмена','Разрешить эту версию'],defaultId:0,cancelId:0});if(a.response!==1)return external.info(id);return external.set(id,{gameId:id,kind:'catalog',packageId:p.id,sha256:p.sha256})});
safeHandler('external:local',async(id,withTable)=>{if(typeof withTable!=='boolean'||!games.some(g=>g.id===id&&g.installed))throw Error('Выберите установленную игру');const r=await dialog.showOpenDialog(win,{title:withTable?'Выберите установленный Cheat Engine':'Выберите свой доверенный EXE-трейнер',properties:['openFile'],filters:[{name:'Executable',extensions:['exe']}]});if(r.canceled)return external.info(id);const exe=await externalTools.fileInfo(r.filePaths[0],'exe');let table=null;if(withTable){if(!/^cheatengine(?:[-_][a-z0-9_-]+)?\.exe$/i.test(path.basename(exe.file)))throw Error('Выберите исполняемый файл Cheat Engine');const t=await dialog.showOpenDialog(win,{title:'Выберите свою проверенную CT-таблицу',properties:['openFile'],filters:[{name:'Cheat Table',extensions:['ct']}]});if(t.canceled)return external.info(id);table=await externalTools.fileInfo(t.filePaths[0],'ct')}const a=await confirmDialog.show({title:'Привязка внешнего трейнера',message:'Разрешить запуск выбранных файлов при запуске этой игры?',detail:path.basename(exe.file)+'\n'+exe.sha256+(table?'\n'+path.basename(table.file)+'\n'+table.sha256:'')+'\nEXE и CT могут содержать произвольный код. Используйте только файлы, которым доверяете, для одиночной игры. Nexora не проверяет их безопасность. Изменение файла потребует нового согласия. Cheat Engine может отдельно запросить разрешение скрипта; Nexora не подтверждает его.',buttons:['Отмена','Разрешить эти файлы'],defaultId:0,cancelId:0});if(a.response!==1)return external.info(id);return external.set(id,{kind:'local',gameId:id,exe,table})});
safeHandler('external:table',async(id,file)=>{
 if(smokeMode||!games.some(g=>g.id===id&&g.installed))throw Error('Сначала установите игру');if(external.active())throw Error('Закройте активный трейнер');
 const r=await dialog.showOpenDialog(win,{title:'Выберите установленный Cheat Engine',properties:['openFile'],filters:[{name:'Executable',extensions:['exe']}]});if(r.canceled)return external.info(id);
 const exe=await externalTools.fileInfo(r.filePaths[0],'exe');if(!/^cheatengine(?:[-_][a-z0-9_-]+)?\.exe$/i.test(path.basename(exe.file)))throw Error('Выберите исполняемый файл Cheat Engine');
 const candidate=await trainerDiscovery.download(id,file),sha256=require('node:crypto').createHash('sha256').update(candidate.bytes).digest('hex');
 const a=await confirmDialog.show({title:'Сторонняя Cheat Table',message:'Разрешить автозапуск этой таблицы в Cheat Engine?',detail:candidate.file+'\n'+candidate.source+'\nSHA-256 CT: '+sha256+'\nSHA-256 EXE: '+exe.sha256+'\nТаблицы сообщества могут содержать произвольный Lua/ASM-код. Скачанные байты сверены с индексом, но безопасность и совместимость не проверены. Разрешайте только известный вам источник для одиночной игры. Nexora не подтверждает запросы исполнения скриптов в Cheat Engine и не включает читы автоматически.',buttons:['Отмена','Разрешить точные файлы'],defaultId:0,cancelId:0});
 if(a.response!==1)return external.info(id);const table=await externalTools.cacheTable(path.join(app.getPath('userData'),'trainer-packages'),candidate.bytes);return external.set(id,{kind:'local',gameId:id,exe,table,tableLabel:candidate.file})
});
safeHandler('external:forget',id=>external.set(id,null));
safeHandler('external:cache-remove',id=>external.removeCache(id));
safeHandler('trainer:source-open',(id,file)=>shell.openExternal(trainerDiscovery.url(id,file)));
safeHandler('launch:cancel',()=>{if(autoTrainer.pending())stopAutoTrainer();return launchSession.cancel()});
const vaultRoot=()=>path.join(app.getPath('userData'),'backups');
async function gk2LiveCall(op,args={}){
 if(gk2Busy)throw Error('Операция выполняется');gk2Busy=true;const previousId=gk2GameId,previousPid=gk2Pid;let lost=false;
 function disconnected(){lost=gk2Active;gk2Active=false;gk2GameId=null;gk2Pid=null;gk2ItemIds=[];gk2Bridge.close()}
 try{const v=await gk2Bridge.request(op,args);if(v.connected===true){gk2Active=true;gk2Pid=v.pid;if(Array.isArray(v.items))gk2ItemIds=v.items.map(x=>x.id).slice(0,512)}else disconnected();return {...v,gameId:gk2GameId}}
 catch(e){disconnected();throw e}
 finally{gk2Busy=false;if(lost&&op!=='gk2-start'&&autoTrainer.state().phase==='ready'&&autoTrainer.state().gameId===previousId){if(op!=='gk2-state'||!autoTrainer.resume(previousId,previousPid))autoTrainer.cancel()}}
}
function stopAutoTrainer(){external?.cancel();const connecting=autoTrainer.state().phase==='connecting';const value=autoTrainer.cancel();if(connecting&&!gk2Active)gk2Bridge.close('Автоподключение отменено');return value}
function endedGame(){const error=Error('Игровой процесс завершён. Запустите игру заново через Nexora.');error.permanent=true;return error}
async function connectGk2(id,expectedPid){
 if(external.active())throw Error('Закройте внешний трейнер');if(gk2Busy||activeGame!==null||updateLaunching)throw Error('Завершите текущую операцию');
 if(gk2Active){if(gk2GameId===id)return gk2LiveCall('gk2-state');throw Error('Сначала отключите другой трейнер')}
 const game=games.find(g=>g.id===id&&g.installed&&gameProfiles.match(g)==='graveyard-keeper-2');const scope=gameScope(game);
 if(expectedPid!==undefined){
  const rows=await discoverLaunchProcesses(scope);if(!rows.some(r=>r.pid===expectedPid))throw endedGame();
  const s=autoTrainer.state();if(s.gameId!==id||s.phase!=='connecting')throw endedGame();
  if(gk2Busy||gk2Active||activeGame!==null||updateLaunching)throw Error('Завершите текущую операцию');
 }
 const result=await gk2LiveCall('gk2-start',scope);
 if(expectedPid!==undefined&&result.connected&&result.pid!==expectedPid){gk2Active=false;gk2GameId=null;gk2Pid=null;gk2Bridge.close();throw endedGame()}
 if(result.connected)gk2GameId=id;return {...result,gameId:gk2GameId}
}
safeHandler('gk2live:start',async id=>{if(external.active())throw Error('Закройте внешний трейнер');if(autoTrainer.pending())stopAutoTrainer();if(gk2Busy||gk2Active||activeGame!==null)throw Error('Завершите текущую сессию');const game=games.find(g=>g.id===id&&g.installed&&gameProfiles.match(g)==='graveyard-keeper-2');const scope=gameScope(game);const answer=await confirmDialog.show({type:'warning',title:'Graveyard Keeper 2',message:'Подключиться к текущему сохранению?',detail:'Только одиночная игра. Автопоиск экспериментальный. Сделайте резервную копию. Изменения могут сохраниться в игре. Фиксация до 5 минут.',buttons:['Отмена','Подключить'],defaultId:0,cancelId:0});if(answer.response!==1)return null;if(activeGame!==null||gk2Active||gk2Busy)throw Error('Сессия уже запущена');return connectGk2(id)});
safeHandler('gk2live:state',()=>gk2Active?gk2LiveCall('gk2-state'):{connected:false,fields:[]});
safeHandler('gk2live:set',(key,value,hold)=>{if(!gk2Active||typeof key!=='string'||typeof value!=='number'||!Number.isFinite(value)||typeof hold!=='boolean')throw Error('Нет сессии или неверное значение');return gk2LiveCall('gk2-set',{key,value,hold})});
safeHandler('gk2live:labels',async()=>{if(!gk2Active||itemLabelsBusy)throw Error('Нет активной сессии или занят переводчик');if(translation.state().running)throw Error('Остановите игровой переводчик');if(!localModel.isReady('lite'))throw Error('Скачайте языковой пакет в разделе Перевод');itemLabelsBusy=true;try{return await itemLabels.label(gk2ItemIds,AbortSignal.timeout(90000))}finally{itemLabelsBusy=false}});
safeHandler('gk2live:stack',(token,count,expected)=>{if(!gk2Active||typeof token!=='string'||!/^[a-f0-9]{32}$/.test(token)||!Number.isInteger(count)||count<1||count>999||!Number.isInteger(expected)||expected<1)throw Error('Неверная стопка');return gk2LiveCall('gk2-stack',{token,count,expected})});
safeHandler('gk2live:inventory',()=>{if(!gk2Active)throw Error('Нет активной сессии');return gk2LiveCall('gk2-inventory')});
safeHandler('gk2live:item',(id,count,expected)=>{if(!gk2Active||typeof id!=='string'||id.length>160||!Number.isInteger(count)||!Number.isInteger(expected)||count<1||count>999||expected<1)throw Error('Неверный предмет или количество');return gk2LiveCall('gk2-item',{id,count,expected})});
safeHandler('gk2live:release',key=>{if(!gk2Active||typeof key!=='string')throw Error('Нет сессии');return gk2LiveCall('gk2-release',{key})});
safeHandler('gk2live:stop',()=>{if(gk2Busy)throw Error('Дождитесь операции');autoTrainer.cancel();gk2Active=false;gk2GameId=null;gk2Pid=null;gk2Bridge.close();return {connected:false,fields:[]}});
safeHandler('save-adapter:scan',engine=>saveExclusive(async()=>{if(smokeMode)return [];const rows=await adapterWorker(engine,'scan',[saveRoot(engine)]);const handles=new Map();const result=rows.map(x=>{const id=randomUUID();handles.set(id,x.file);return {id,label:x.label,modified:x.modified,hasInfo:x.hasInfo}});saveSlots.set(engine,handles);return result}));
safeHandler('save-adapter:open',(engine,id)=>saveExclusive(async()=>{const root=saveRoot(engine);let file;if(id===null){const opts={title:'Выберите файл сохранения',defaultPath:fs.existsSync(root)?root:undefined,properties:['openFile']};if(engine==='gk2')opts.filters=[{name:'Game save',extensions:['dat']}];const r=await dialog.showOpenDialog(win,opts);if(r.canceled)return null;file=r.filePaths[0]}else{file=saveSlots.get(engine)?.get(id);if(!file)throw Error('Обновите список сохранений')}const v=await adapterWorker(engine,'open',[file]);openedSaves.set(engine,v);return {name:path.basename(file),fields:v.fields,hasInfo:v.hasInfo}}));
safeHandler('save-adapter:export',(engine,changes)=>saveExclusive(async()=>{const opened=openedSaves.get(engine);if(!opened)throw Error('Сначала откройте сохранение');const r=await dialog.showOpenDialog(win,{title:'Папка для изменённой копии',properties:['openDirectory']});if(r.canceled)return null;const answer=await confirmDialog.show({title:'Редактор сохранений',message:'Экспортировать изменённую копию?',detail:'Исходные файлы не изменяются. Закройте игру, создайте резервную копию и проверьте совместимость перед заменой слота.',buttons:['Отмена','Экспортировать'],defaultId:0,cancelId:0});if(answer.response!==1)return null;const v=await adapterWorker(engine,'export',[opened,changes,r.filePaths[0]]);return {folder:v.folder,fields:v.fields}}));
safeHandler('trainer:diagnostics',id=>{const g=games.find(x=>x.id===id);if(!g)throw Error('Игра не найдена');const p=gameProfiles.find(gameProfiles.match(g)),report={version:app.getVersion(),platform:process.platform,arch:process.arch,catalog:gameProfiles.profileState(),...adapters.describe(p,g,autoTrainer.state(),trainerDiscovery.get(id)),nativeHelper:fs.existsSync(path.join(__dirname,'native-bin','Nexora.Memory.exe'))};clipboard.writeText(JSON.stringify(report,null,2));return report});
safeHandler('gk2:open',()=>saveExclusive(async()=>{const dir=path.join(require('node:os').homedir(),'AppData','LocalLow','Lazy Bear Games','Graveyard Keeper 2');const r=await dialog.showOpenDialog(win,{title:'Graveyard Keeper 2 · выберите сохранение',defaultPath:fs.existsSync(dir)?dir:undefined,properties:['openFile'],filters:[{name:'Graveyard Keeper 2 save',extensions:['dat']}]});if(r.canceled)return null;gk2Opened=await gk2Run('open',[r.filePaths[0]]);return {name:path.basename(gk2Opened.file),fields:gk2Opened.fields,hasInfo:gk2Opened.hasInfo}}));
safeHandler('gk2:export',changes=>saveExclusive(async()=>{if(!gk2Opened)throw Error('Сначала откройте сохранение');const r=await dialog.showOpenDialog(win,{title:'Выберите папку для новой копии',properties:['openDirectory']});if(r.canceled)return null;const answer=await confirmDialog.show({type:'question',title:'Graveyard Keeper 2',message:'Создать изменённую копию сохранения?',detail:'Оригинальные .dat и .info не изменяются. Новая пара сохраняется в отдельной папке. Закройте игру и сделайте резервную копию перед использованием.',buttons:['Отмена','Экспортировать'],defaultId:0,cancelId:0});if(answer.response!==1)return null;const result=await gk2Run('export',[gk2Opened,changes,r.filePaths[0]]);return {folder:result.folder,fields:result.fields}}));
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
safeHandler('trainer:save-recipe',(gameId,value)=>{if(!games.some(g=>g.id===gameId))throw Error('Игра не найдена');state.trainerRecipes=saveRecipe(state.trainerRecipes,gameId,value);persist();return refresh(false)});
safeHandler('trainer:delete-recipe',(gameId,id)=>{state.trainerRecipes=state.trainerRecipes.filter(x=>!(x.gameId===gameId&&x.id===id));persist();return refresh(false)});
safeHandler('memory:list',id=>bridge.request('list',scopeOf(id)));
safeHandler('memory:attach',async(id,pid)=>{if(external.active()||autoTrainer.pending()||gk2Active||gk2Busy)throw Error('Завершите активную сессию трейнера');
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
safeHandler('translation:model-install',async(pack='q8')=>{if(itemLabelsBusy)throw Error('Дождитесь перевода названий');packFiles(pack);if(translation.state().running)throw Error('Остановите перевод перед установкой');const answer=await confirmDialog.show({type:'question',title:'Локальный языковой пакет',message:'Скачать модель английский → русский?',detail:(pack==='m2m'?'Около 650 МБ, M2M100. ':pack==='fp32'?'Около 450 МБ, полные веса. ':'Около 250 МБ, квантованные веса. ')+'Загрузка выполняется один раз. Текст игры не отправляется. После скачивания перевод работает без API-ключей и интернета.',buttons:['Отмена','Скачать'],defaultId:0,cancelId:0});if(itemLabelsBusy)throw Error('Дождитесь перевода названий');return answer.response===1?localModel.install(pack):localModel.state()});
safeHandler('translation:model-cancel',()=>localModel.cancel());
safeHandler('translation:model-remove',async pack=>{if(itemLabelsBusy)throw Error('Дождитесь перевода названий');packFiles(pack);if(translation.state().running)throw Error('Остановите перевод');const answer=await confirmDialog.show({type:'question',title:'Удаление языкового пакета',message:'Удалить выбранный пакет?',detail:'Удаляются только известные файлы выбранной модели. Другие модели, моды и сохранения остаются. Пакет можно скачать заново.',buttons:['Отмена','Удалить'],defaultId:0,cancelId:0});if(answer.response!==1)return localModel.state();if(translation.state().running||itemLabelsBusy)throw Error('Остановите перевод');return localModel.remove(pack,[...state.downloads.map(x=>x.path),...state.installedMods.map(x=>x.folder),...state.manual.map(x=>x.path),...state.backups.map(x=>x.source),...state.backups.map(x=>x.path)])});
safeHandler('updates:check',()=>updates.check());
safeHandler('updates:open',()=>shell.openExternal(updates.page()));
safeHandler('updates:state',()=>updater.state());
safeHandler('updates:download',()=>updater.download());
safeHandler('updates:cancel',()=>{updater.cancel();return true});
safeHandler('updates:install',async()=>{
 if(updateLaunching)throw Error('Установка уже запущена');
 const installDir=path.dirname(process.execPath);if(!app.isPackaged||!fs.existsSync(path.join(installDir,'installed.marker')))throw Error('Для портативной версии установите новый выпуск вручную.');
 const blocked=()=>external.active()||itemLabelsBusy||rconBusy||autoTrainer.pending()||gk2Active||gk2Busy||saveBusy||managerBusy||thunderBusy||activeGame!==null||tracker.state().active||tracker.state().busy||translation.state().running||localModel.state().installing||localModel.state().removing||['checking','launching','waiting'].includes(launchSession.state().phase);
 if(blocked())throw Error('Завершите игровые сессии и операции с файлами перед обновлением.');
 updateLaunching=true;try{const info=await updater.verified();const answer=await confirmDialog.show({type:'question',title:'Обновление Nexora',message:'Установить Nexora '+info.version+'?',detail:'Установщик скачан из официального релиза и проверен по SHA-256. Программа закроется, мастер обновит файлы в текущей папке. Модели, настройки, моды и сохранения остаются. Установщик пока не подписан цифровой подписью.',buttons:['Отмена','Обновить'],defaultId:0,cancelId:0});if(answer.response!==1)return false;if(blocked())throw Error('Сначала завершите текущие операции');await updater.verified();await new Promise((resolve,reject)=>{const p=spawn(info.file,['/DIR='+installDir,'/NORESTART'],{detached:true,stdio:'ignore',windowsHide:false});p.once('error',reject);p.once('spawn',()=>{p.unref();resolve()})});app.quit();return true}finally{updateLaunching=false}
});
safeHandler('commands:list',()=>gameProfiles.summaries());
safeHandler('catalog:details',id=>gameProfiles.details(id));
safeHandler('catalog:sync',async()=>{const result=await gameProfiles.sync(app.getPath('userData'));return {result,profiles:gameProfiles.summaries(),data:refresh(true)}});
safeHandler('catalog:state',()=>gameProfiles.profileState());
safeHandler('commands:copy',(game,command)=>{const value=lookupCommand(game,command);clipboard.writeText(value);return true});
function consoleProfile(g){const n=(g?.name||'').toLowerCase();return ['steam:489830','steam:72850'].includes(g?.id)||n.includes('skyrim')?'skyrim':g?.id==='steam:377160'||n.includes('fallout 4')?'fallout4':null}
function consoleMessage(message){if(win&&!win.isDestroyed())win.webContents.send('commands:status',message)}
async function queueConsole(gameId,profile,command){
 if(consoleBusy||!globalShortcut.isRegistered('Alt+Shift+F8'))throw Error('Горячая клавиша недоступна или команда выполняется');
 const game=games.find(g=>g.id===gameId&&g.installed);if(!game||consoleProfile(game)!==profile)throw Error('Выберите установленную поддерживаемую игру');
 const scope=gameScope(game);const answer=await confirmDialog.show({type:'question',title:'Отправка команды',message:'Подготовить команду для '+game.name+'?',detail:'Одиночная игра. Открой пустую игровую консоль, выбери ENG US и нажми Alt+Shift+F8. Nexora введёт команду только в окно выбранной игры. После проверки нажми Enter самостоятельно. Команда действует 60 секунд.',buttons:['Отмена','Подготовить'],defaultId:0,cancelId:0});if(answer.response!==1)return false;
 queuedConsole={...scope,profile,command,expires:Date.now()+60000};consoleMessage('Команда подготовлена. Открой консоль игры и нажми Alt+Shift+F8.');return true
}
async function sendQueuedConsole(){if(consoleBusy)return;const q=queuedConsole;queuedConsole=null;if(!q||Date.now()>q.expires){consoleMessage('Нет подготовленной команды или время истекло.');return}consoleBusy=true;try{const {expires,...args}=q;await consoleBridge.request('console-send',args);consoleMessage('Команда введена. Проверь её в консоли игры и нажми Enter.')}catch(e){consoleMessage(e.message||String(e))}finally{consoleBusy=false;consoleBridge.close()}}
safeHandler('commands:queue',(gameId,profile,id)=>queueConsole(gameId,profile,lookupCommand(profile,id)));
safeHandler('items:queue',(gameId,profile,id,count)=>queueConsole(gameId,profile,gameItems.spawnCommand(profile,id,count)));

safeHandler('items:search',(game,q,cat,offset=0)=>{if(typeof q!=='string'||q.length>200||typeof cat!=='string')throw Error('Неверный поиск');return gameItems.searchPage(game,q,cat,offset)});
safeHandler('items:copy',(game,id,count)=>{clipboard.writeText(gameItems.spawnCommand(game,id,count));return true});
safeHandler('rcon:connect',async value=>{if(rconBusy)throw Error('Операция выполняется');const v=rcon.settings(value);rconBusy=true;try{const answer=await confirmDialog.show({type:'warning',title:'Локальный Minecraft',message:'Подключиться к собственному серверу?',detail:'Только 127.0.0.1. RCON должен быть включён заранее на вашем выделенном сервере. Не открывайте порт в интернет. Пароль хранится только в памяти. Действия меняют мир выбранного игрока.',buttons:['Отмена','Подключить'],cancelId:0,defaultId:0});if(answer.response!==1)return null;await rcon.exchange(v,'list');localRcon=v;return {player:v.player}}finally{rconBusy=false}});
safeHandler('rcon:disconnect',()=>{if(rconBusy)throw Error('Операция выполняется');localRcon=null;if(autoTrainer.state().gameId&&adapters.capability(gameProfiles.find(gameProfiles.match(games.find(g=>g.id===autoTrainer.state().gameId)))).mode==='rcon')autoTrainer.cancel();return true});
async function localCommand(build){if(!localRcon||rconBusy)throw Error('Подключите локальный сервер');rconBusy=true;try{return {response:await rcon.exchange(localRcon,build(localRcon.player))}}catch(e){localRcon=null;throw e}finally{rconBusy=false}}
safeHandler('rcon:action',(id,on)=>localCommand(player=>rcon.actionCommand(player,id,on)));
safeHandler('rcon:item',(id,count)=>localCommand(player=>gameItems.spawnCommand('minecraft',id,count,player)));



safeHandler('translation:start',async value=>{if(itemLabelsBusy)throw Error('Дождитесь перевода названий');
 const config=translationSettings(value);
 const detail=['ocr','local'].includes(config.provider)?'Распознавание и выбранная локальная обработка выполняются без отправки текста или изображений.':'Распознанный английский текст выбранного окна или области будет передаваться сервису '+(config.provider==='deepl'?'DeepL':'MyMemory')+'. Изображения не отправляются. Не оставляйте в области личные данные; сервис имеет собственные правила и лимиты. В режиме окна захват приостанавливается при переключении; в режиме области следит за экраном. Не захватывайте личные данные.';
 const c=await confirmDialog.show({type:'question',title:'Экранный перевод',message:config.mode==='window'?'Начать перевод выбранного игрового окна?':'Начать захват выбранной области экрана?',detail:detail+(config.provider==='local'&&config.mode==='window'?'\nСессия работает до остановки или закрытия игрового окна.':'\nСессия ограничена 30 минутами.')+' Остановить можно из Nexora.',buttons:['Отмена','Начать'],defaultId:0,cancelId:0});
 if(c.response!==1)return null;if(itemLabelsBusy)throw Error('Дождитесь перевода названий');if(localModel.state().removing||localModel.state().installing)throw Error('Дождитесь завершения операции с моделью');return translation.start(config);
});
safeHandler('translation:stop',()=>translation.stop());
let quitting=false;
app.on('before-quit',e=>{if(!quitting&&tracker?.state().active){e.preventDefault();quitting=true;const deadline=setTimeout(()=>app.quit(),6000);tracker.shutdown().catch(()=>{}).finally(()=>{clearTimeout(deadline);app.quit()});return}queuedConsole=null;globalShortcut.unregister('Alt+Shift+F8');consoleBridge.close();autoTrainer?.cancel();external?.close();gk2Bridge.close();updater?.close();confirmDialog?.close();launchSession?.close();launchBridge.close();bridge.close();pluginBridge.close();overlay?.close();translation?.stop();localModel?.cancel();localModel?.close()});

app.on('second-instance',()=>{if(win&&!win.isDestroyed()){if(win.isMinimized())win.restore();win.show();win.focus()}});
app.whenReady().then(()=>{globalShortcut.register('Alt+Shift+F8',()=>void sendQueuedConsole());configureScratch(app.getPath('userData'));load();gameProfiles.loadCache(app.getPath('userData'));trainerDiscovery=createDiscovery({root:app.getPath('userData'),match:gameProfiles.match,details:gameProfiles.details,sync:()=>gameProfiles.sync(app.getPath('userData'))});updater=createInstaller({current:app.getVersion(),root:path.join(app.getPath('userData'),'updates'),check:()=>updates.check(),send:value=>{if(win&&!win.isDestroyed())win.webContents.send('updates:changed',value)}});external=externalTools.createExternal({root:path.join(app.getPath('userData'),'trainer-packages'),findGame:id=>games.find(x=>x.id===id),getPrefs:()=>state.externalTrainers,setPrefs:rows=>{state.externalTrainers=rows;persist()},send:v=>{if(['closed','error'].includes(v.phase)&&autoTrainer?.state().phase==='ready'&&autoTrainer.state().gameId===v.gameId)autoTrainer.cancel();if(win&&!win.isDestroyed())win.webContents.send('external:changed',v)}});autoTrainer=createAutoTrainer({resolve:id=>{const g=games.find(x=>x.id===id&&x.installed);if(external.preference(id))return 'external';if(external.active())return null;return adapters.autoAdapter(gameProfiles.find(gameProfiles.match(g)),{rconConfigured:!!localRcon})},connect:async(id,adapter,expectedPid)=>{if(adapter==='external'){const g=games.find(x=>x.id===id&&x.installed);if(gk2Active||gk2Busy||activeGame!==null||updateLaunching)throw Error('Завершите текущую сессию');const guard=()=>autoTrainer.state().gameId===id&&autoTrainer.state().phase==='connecting';if(!guard()||!(await discoverLaunchProcesses(gameScope(g))).length)throw Error('Игровой процесс не найден');return external.launch(id,async()=>guard()&&(await discoverLaunchProcesses(gameScope(g))).length>0&&guard())}if(adapter==='gk2')return connectGk2(id,expectedPid);if(adapter==='rcon'){if(!localRcon||rconBusy){const e=Error('Настройте локальный сервер Minecraft');e.permanent=true;throw e}const v=localRcon;rconBusy=true;try{await rcon.exchange(v,'list');if(autoTrainer.state().gameId!==id||autoTrainer.state().phase!=='connecting')throw Error('Подключение отменено');return {connected:true,adapter:'rcon',player:v.player}}catch(e){if(localRcon===v)localRcon=null;e.permanent=true;throw e}finally{rconBusy=false}}throw Error('Нет адаптера')},send:(value,live)=>{if(win&&!win.isDestroyed())win.webContents.send('trainer:auto-changed',{...value,live})}});launchSession=createLaunchSession({findGame:id=>games.find(g=>g.id===id&&g.installed),scopeOf:gameScope,launch:launchGame,list:discoverLaunchProcesses,send:value=>{if(win&&!win.isDestroyed())win.webContents.send('launch:changed',value);autoTrainer.observe(value)}});tracker=createTracker({bridge:playBridge,monitor,getHistory:()=>state.playSessions,saveHistory:rows=>{state.playSessions=rows;persist()},send:value=>{if(win&&!win.isDestroyed())win.webContents.send('play:changed',value)}});session.defaultSession.setPermissionRequestHandler((_wc,_permission,cb)=>cb(false));win=new BrowserWindow({width:1280,height:850,minWidth:780,minHeight:620,backgroundColor:'#101117',autoHideMenuBar:true,title:'Nexora',...(process.platform==='win32'?{titleBarStyle:'hidden',titleBarOverlay:{color:'#15141e',symbolColor:'#d1c9e8',height:36}}:{}),webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});confirmDialog=createConfirm({BrowserWindow,ipcMain,parent:win,dir:__dirname});win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());overlay=createOverlay({BrowserWindow,screen,globalShortcut,ipcMain,monitor,dir:__dirname,onChange:value=>{if(win&&!win.isDestroyed())win.webContents.send('hud:changed',value)}});localModel=createLocalModel(path.join(app.getPath('userData'),'translation-models'),value=>{if(win&&!win.isDestroyed())win.webContents.send('translation:model-changed',value)});translation=createTranslation({localModel,BrowserWindow,screen,desktopCapturer,globalShortcut,ipcMain,main:win,dir:__dirname,onChange:value=>{if(win&&!win.isDestroyed())win.webContents.send('translation:changed',value)}});win.on('closed',()=>{overlay.close();translation.stop();app.quit()});if(smokeMode)require('./ui-smoke.cjs').runSmoke(win,app,profileRoot,confirmDialog);win.loadFile('index.html')});
app.on('window-all-closed',()=>app.quit());
