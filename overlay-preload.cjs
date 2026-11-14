const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('hud',Object.freeze({sample:()=>ipcRenderer.invoke('overlay:sample')}));
