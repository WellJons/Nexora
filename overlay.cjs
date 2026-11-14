const path=require('node:path');
const WIDTH=306,HEIGHT=166;
function position(workArea,corner='top-right'){
 const {x,y,width,height}=workArea;
 const w=Math.min(WIDTH,width),h=Math.min(HEIGHT,height),gap=Math.min(20,Math.max(0,Math.floor(Math.min(width-w,height-h)/2)));
 return {x:corner.endsWith('right')?x+width-w-gap:x+gap,y:corner.startsWith('bottom')?y+height-h-gap:y+gap,width:w,height:h};
}
function createOverlay({BrowserWindow,screen,globalShortcut,ipcMain,monitor,dir,onChange}){
 let window=null,enabled=false,corner='top-right',registered=false,ready=false;
 const key='Control+Shift+F10';
 const state=()=>({enabled,visible:!!window&&!window.isDestroyed()&&window.isVisible(),corner,hotkey:registered?'Ctrl + Shift + F10':null});
 function notify(){onChange?.(state());}
 function place(){if(window&&!window.isDestroyed()){const display=screen.getDisplayNearestPoint(screen.getCursorScreenPoint());window.setBounds(position(display.workArea,corner))}}
 function toggle(){if(!enabled||!window||window.isDestroyed()||!ready)return state();if(window.isVisible())window.hide();else{place();window.showInactive()}notify();return state()}
 function disable(){enabled=false;ready=false;if(registered)globalShortcut.unregister(key);registered=false;const w=window;window=null;if(w&&!w.isDestroyed())w.destroy();notify();return state()}
 function configure(config){
  if(typeof config?.enabled!=='boolean'||!['top-right','top-left','bottom-right','bottom-left'].includes(config.corner))throw Error('Некорректные параметры оверлея');
  corner=config.corner;
  if(!config.enabled)return disable();
  if(enabled){place();notify();return state()}
  const w=new BrowserWindow({width:WIDTH,height:HEIGHT,show:false,frame:false,transparent:true,focusable:false,alwaysOnTop:true,skipTaskbar:true,resizable:false,movable:false,hasShadow:false,webPreferences:{preload:path.join(dir,'overlay-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  window=w;enabled=true;ready=false;w.setAlwaysOnTop(true,'floating');w.setIgnoreMouseEvents(true);
  w.webContents.setWindowOpenHandler(()=>({action:'deny'}));w.webContents.on('will-navigate',e=>e.preventDefault());
  w.on('closed',()=>{if(window===w){window=null;disable()}});
  w.once('ready-to-show',()=>{if(window===w&&enabled){ready=true;place();w.showInactive();notify()}});
  w.loadFile(path.join(dir,'overlay.html')).catch(()=>{if(window===w)disable()});
  registered=globalShortcut.register(key,toggle);notify();return state()
 }
 ipcMain.handle('overlay:sample',async e=>{if(!window||window.isDestroyed()||e.sender!==window.webContents||e.senderFrame!==window.webContents.mainFrame||!window.isVisible())return null;return monitor.sample()});
 return {configure,toggle,state,close:disable};
}
module.exports={position,createOverlay};
