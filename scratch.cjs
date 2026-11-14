const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
let root=null;
function configureScratch(data){const folder=path.join(data,'scratch');fs.mkdirSync(folder,{recursive:true});const stat=fs.lstatSync(folder);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Некорректная папка временных файлов');root=folder}
function scratch(){return root||os.tmpdir()}
module.exports={configureScratch,scratch};
