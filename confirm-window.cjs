const path=require('node:path');
function normalize(options){
 if(!options||!Array.isArray(options.buttons)||options.buttons.length!==2||options.cancelId!==0||options.defaultId!==0)throw Error('Invalid confirmation');
 const string=(value,name,max)=>{if(typeof value!=='string'||value.length>max)throw Error('Invalid '+name);return value};
 return {title:string(options.title||'Nexora','title',200),message:string(options.message,'message',500),detail:string(options.detail||'','detail',100000),buttons:options.buttons.map(v=>string(v,'button',100)),warning:options.type==='warning'};
}
function createConfirm({BrowserWindow,ipcMain,parent,dir}){
 let active=null;
 function finish(response){const a=active;if(!a)return;active=null;if(!a.win.isDestroyed())a.win.destroy();a.resolve({response:response===1?1:0})}
 function allowed(e){return active&&e.sender===active.win.webContents&&e.senderFrame===active.win.webContents.mainFrame}
 ipcMain.handle('confirm:state',e=>{if(!allowed(e))throw Error('Invalid origin');return active.data});
 ipcMain.handle('confirm:answer',(e,value)=>{if(!allowed(e)||![0,1].includes(value))throw Error('Invalid confirmation');const a=active;setImmediate(()=>{if(active===a)finish(value)});return true});
 async function show(options){
  const data=normalize(options);if(active||parent.isDestroyed())return {response:0};
  return new Promise(resolve=>{
   const win=new BrowserWindow({parent,modal:true,width:580,height:440,minWidth:440,minHeight:320,show:false,backgroundColor:'#181923',title:'Nexora',autoHideMenuBar:true,minimizable:false,maximizable:false,webPreferences:{preload:path.join(dir,'confirm-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
   const a={win,data,resolve};active=a;
   win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());
   win.once('ready-to-show',()=>{if(active===a&&!win.isDestroyed())win.show()});
   win.on('closed',()=>{if(active===a)finish(0)});
   win.webContents.on('render-process-gone',()=>{if(active===a)finish(0)});
   win.loadFile(path.join(dir,'confirm.html')).then(()=>{if(active===a&&!win.isDestroyed()&&!win.isVisible())win.show()}).catch(()=>{if(active===a)finish(0)});
  });
 }
 return {show,close:()=>finish(0),current:()=>active?.win||null}
}
module.exports={normalize,createConfirm};
