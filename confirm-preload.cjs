const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('nexoraConfirm',Object.freeze({state:()=>ipcRenderer.invoke('confirm:state'),answer:v=>ipcRenderer.invoke('confirm:answer',v)}));
