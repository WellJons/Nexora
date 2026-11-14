const path=require('node:path');const {createSession,createOcr,cropRect}=require('./translator.cjs');
function createTranslation({BrowserWindow,screen,desktopCapturer,globalShortcut,ipcMain,main,dir,onChange}){
 let view=null,rect=null,registered=false,config=null;const shortcut='Alt+Shift+T';
 function destroy(){if(registered)globalShortcut.unregister(shortcut);registered=false;const w=view;view=null;if(w&&!w.isDestroyed())w.destroy()}
 function report(state){const value={...state,hotkey:state.running&&registered?'Alt + Shift + T':null};onChange(value);if(view&&!view.isDestroyed())view.webContents.send('translation:caption',value);if(!state.running)destroy()}
 async function capture(s){const display=screen.getAllDisplays().find(d=>d.id===s.display);if(!display)throw Error('Выбранный экран отключён');const ratio=Math.min(1,1920/(display.size.width*display.scaleFactor),1080/(display.size.height*display.scaleFactor));const width=Math.round(display.size.width*display.scaleFactor*ratio),height=Math.round(display.size.height*display.scaleFactor*ratio);
 const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width,height},fetchWindowIcons:false});const image=sources.find(x=>x.display_id===String(s.display))?.thumbnail;if(!image||image.isEmpty())throw Error('Не удалось получить изображение экрана');return image.crop(cropRect(s.region,image.getSize())).toPNG()}
 const session=createSession({capture,ocr:createOcr(),send:report,canCapture:()=>!main.isDestroyed()&&!main.isFocused()});
 const stop=()=>session.stop();
 function start(s){const display=screen.getAllDisplays().find(d=>d.id===s.display);if(!display)throw Error('Экран не найден');if(session.state().running)throw Error('Перевод уже запущен');
 const r=s.region,a=display.workArea,w=Math.min(760,a.width-20),h=Math.min(152,a.height-20),top=r.y+r.h/2>.5;rect={x:Math.round(a.x+(a.width-w)/2),y:top?a.y+10:a.y+a.height-h-10,width:w,height:h};
 const v=new BrowserWindow({...rect,show:false,frame:false,transparent:true,focusable:false,alwaysOnTop:true,skipTaskbar:true,resizable:false,hasShadow:false,webPreferences:{preload:path.join(dir,'translation-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});view=v;v.setIgnoreMouseEvents(true);v.setContentProtection(true);v.setAlwaysOnTop(true,'floating');v.webContents.setWindowOpenHandler(()=>({action:'deny'}));v.webContents.on('will-navigate',e=>e.preventDefault());v.once('ready-to-show',()=>{if(view===v&&session.state().running)v.showInactive()});v.on('closed',()=>{if(view===v){view=null;session.stop()}});v.loadFile(path.join(dir,'translation.html')).catch(()=>session.stop('Не удалось открыть оверлей'));
 registered=globalShortcut.register(shortcut,stop);try{return {...session.start(s),hotkey:registered?'Alt + Shift + T':null}}catch(e){destroy();throw e}}
 ipcMain.handle('translation:caption-state',e=>{if(!view||view.isDestroyed()||e.sender!==view.webContents||e.senderFrame!==view.webContents.mainFrame)throw Error('Invalid origin');return {...session.state(),hotkey:registered?'Alt + Shift + T':null}});
 return {start,stop,state:()=>({...session.state(),hotkey:registered?'Alt + Shift + T':null}),displays:()=>screen.getAllDisplays().map((d,i)=>({id:d.id,name:d.label||'Экран '+(i+1),width:d.size.width,height:d.size.height}))}
}
module.exports={createTranslation};
