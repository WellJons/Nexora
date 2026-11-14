const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('caption',Object.freeze({state:()=>ipcRenderer.invoke('translation:caption-state'),onChange:fn=>ipcRenderer.on('translation:caption',(_e,v)=>fn(v))}));
