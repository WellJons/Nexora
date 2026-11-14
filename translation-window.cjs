const path=require('node:path');const {createSession,createOcr,cropRect,settings,translate}=require('./translator.cjs');const {createBridge}=require('./memory-bridge.cjs');
function createTranslation({BrowserWindow,screen,desktopCapturer,globalShortcut,ipcMain,main,dir,onChange,localModel}){
 let view=null,registered=false,config=null,focusTimer=null,focusPending=null,focusInfo=null,initialPid=null,ready=false;const shortcut='Alt+Shift+T';
 const helper=createBridge(path.join(dir,'native-bin','Nexora.Memory.exe'));
 function destroy(){if(focusTimer){clearInterval(focusTimer);focusTimer=null}config=null;focusInfo=null;initialPid=null;ready=false;helper.close();if(registered)globalShortcut.unregister(shortcut);registered=false;const w=view;view=null;if(w&&!w.isDestroyed())w.destroy()}
 function report(state){const value={...state,hotkey:state.running&&registered?'Alt + Shift + T':null};onChange(value);if(view&&!view.isDestroyed())view.webContents.send('translation:caption',value);if(!state.running){destroy();localModel.close()}}
 function sourcesOptions(thumbnailSize){return {types:['window'],thumbnailSize,fetchWindowIcons:false}}
 async function windows(){const sources=await desktopCapturer.getSources(sourcesOptions({width:0,height:0}));return sources.filter(s=>/^window:[1-9]\d{0,18}:0$/.test(s.id)&&s.name.trim()).map(s=>({id:s.id,name:s.name.slice(0,200)}))}
 function foreground(){return config?.mode==='window'?!!focusInfo?.foreground&&!main.isDestroyed()&&!main.isFocused():!main.isDestroyed()&&!main.isFocused()}
 async function focus(){const current=config;if(!current||current.mode!=='window')return null;if(focusPending)return focusPending;
  const work=(async()=>{const info=await helper.request('window-info',{handle:current.source.split(':')[1]});if(config!==current)return null;
   if(!info.exists||info.pid!==initialPid){session.stop('Игровое окно закрыто или изменилось');return null}focusInfo=info;
   if(view&&!view.isDestroyed()){if(info.foreground&&ready&&!main.isFocused()){const b=screen.screenToDipRect(null,info.bounds),old=view.getBounds();if(['x','y','width','height'].some(k=>old[k]!==b[k]))view.setBounds(b);if(!view.isVisible())view.showInactive()}else if(view.isVisible())view.hide()}
   return info;
  })();focusPending=work;try{return await work}catch(e){if(config===current){focusInfo=null;if(view&&!view.isDestroyed())view.hide()}return null}finally{if(focusPending===work)focusPending=null}}
 async function capture(s){
  if(s.mode==='window'){const before=await focus();if(!before?.foreground||!foreground())return null;const {width,height}=before.bounds,ratio=Math.min(1,1920/width,1080/height);
   const sources=await desktopCapturer.getSources(sourcesOptions({width:Math.max(1,Math.round(width*ratio)),height:Math.max(1,Math.round(height*ratio))}));const image=sources.find(x=>x.id===s.source)?.thumbnail;
   const after=await focus();if(!after?.foreground||!foreground()||['x','y','width','height'].some(k=>before.bounds[k]!==after.bounds[k]))return null;
   if(!image||image.isEmpty())throw Error('Игровое окно недоступно для захвата');const size=image.getSize();if(Math.abs(size.width/size.height-width/height)>.12)throw Error('Формат кадра не совпадает с окном');return {buffer:image.toPNG(),size}
  }
  const display=screen.getAllDisplays().find(d=>d.id===s.display);if(!display)throw Error('Выбранный экран отключён');const ratio=Math.min(1,1920/(display.size.width*display.scaleFactor),1080/(display.size.height*display.scaleFactor));const width=Math.round(display.size.width*display.scaleFactor*ratio),height=Math.round(display.size.height*display.scaleFactor*ratio);
  const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width,height},fetchWindowIcons:false});const image=sources.find(x=>x.display_id===String(s.display))?.thumbnail;if(!image||image.isEmpty())throw Error('Не удалось получить изображение экрана');return image.crop(cropRect(s.region,image.getSize())).toPNG()
 }
 const session=createSession({capture,ocr:createOcr(),send:report,canCapture:foreground,translateFn:(text,config,signal)=>config.provider==='local'?localModel.translate(text,signal):translate(text,config,signal)});
 const stop=()=>session.stop();
 async function start(value){if(session.state().running||config)throw Error('Перевод уже запущен');const s=settings(value);if(s.provider==='local'&&!localModel.state().ready)throw Error('Сначала скачайте языковой пакет');config=s;
  try{let rect;
   if(s.mode==='window'){if(!(await windows()).some(w=>w.id===s.source))throw Error('Выбранное окно больше недоступно');const info=await helper.request('window-info',{handle:s.source.split(':')[1]});if(!info.exists)throw Error('Окно не найдено');initialPid=info.pid;focusInfo=info;rect=screen.screenToDipRect(null,info.bounds)}
   else{const display=screen.getAllDisplays().find(d=>d.id===s.display);if(!display)throw Error('Экран не найден');const r=s.region,a=display.workArea,w=Math.min(760,a.width-20),h=Math.min(152,a.height-20),top=r.y+r.h/2>.5;rect={x:Math.round(a.x+(a.width-w)/2),y:top?a.y+10:a.y+a.height-h-10,width:w,height:h}}
   const v=new BrowserWindow({...rect,show:false,frame:false,transparent:true,focusable:false,alwaysOnTop:true,skipTaskbar:true,resizable:false,hasShadow:false,webPreferences:{preload:path.join(dir,'translation-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});view=v;v.setIgnoreMouseEvents(true);v.setContentProtection(true);v.setAlwaysOnTop(true,'floating');v.webContents.setWindowOpenHandler(()=>({action:'deny'}));v.webContents.on('will-navigate',e=>e.preventDefault());v.once('ready-to-show',()=>{ready=true;if(view===v&&session.state().running){if(s.mode==='window')focus();else v.showInactive()}});v.on('closed',()=>{if(view===v){view=null;session.stop()}});v.loadFile(path.join(dir,'translation.html')).catch(()=>session.stop('Не удалось открыть оверлей'));
   registered=globalShortcut.register(shortcut,stop);const state=session.start(s);if(s.mode==='window'){focusTimer=setInterval(focus,700);focus()}return {...state,hotkey:registered?'Alt + Shift + T':null}
  }catch(e){destroy();throw e}
 }
 ipcMain.handle('translation:caption-state',e=>{if(!view||view.isDestroyed()||e.sender!==view.webContents||e.senderFrame!==view.webContents.mainFrame)throw Error('Invalid origin');return {...session.state(),hotkey:registered?'Alt + Shift + T':null}});
 return {start,stop,windows,state:()=>({...session.state(),hotkey:registered?'Alt + Shift + T':null}),displays:()=>screen.getAllDisplays().map((d,i)=>({id:d.id,name:d.label||'Экран '+(i+1),width:d.size.width,height:d.size.height}))}
}
module.exports={createTranslation};
