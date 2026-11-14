const fs=require('node:fs/promises'),path=require('node:path');
const adapters={gk2:require('./gk2-save.cjs'),stardew:require('./stardew-save.cjs')};
function get(engine){if(!Object.hasOwn(adapters,engine))throw Error('Неизвестный редактор');return adapters[engine]}
async function regular(file){try{const s=await fs.lstat(file);return s.isFile()&&!s.isSymbolicLink()&&s.size>0&&s.size<=64*1024*1024?s:null}catch{return null}}
async function scan(engine,root){get(engine);let out=[];async function visit(folder,depth){if(out.length>=80)return;let list;try{const st=await fs.lstat(folder);if(!st.isDirectory()||st.isSymbolicLink())return;list=await fs.readdir(folder,{withFileTypes:true})}catch(e){if(e.code==='ENOENT')return;throw e}
 for(const x of list.slice(0,1600)){if(out.length>=80)return;if(x.isSymbolicLink())continue;const file=path.join(folder,x.name);if(engine==='gk2'){if(x.isDirectory()&&depth<2)await visit(file,depth+1);else if(x.isFile()&&/\.dat$/i.test(x.name)){const s=await regular(file);if(s)out.push({file,label:x.name,modified:s.mtimeMs,hasInfo:!!await regular(file.slice(0,-4)+'.info')})}}else if(depth===0&&x.isDirectory()&&/_[0-9]{1,20}$/.test(x.name)){const save=path.join(file,x.name),s=await regular(save);if(s&&await regular(path.join(file,'SaveGameInfo')))out.push({file:save,label:x.name,modified:s.mtimeMs,hasInfo:true})}}
 }await visit(root,0);return out.sort((a,b)=>b.modified-a.modified)}
module.exports={get,scan};
