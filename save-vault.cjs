const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const fsp=fs.promises;
const norm=p=>process.platform==='win32'?p.toLowerCase():p;
function inside(root,target){const rel=path.relative(norm(root),norm(target));return rel===''||(!path.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+path.sep))}
async function directory(p){if(typeof p!=='string'||!path.isAbsolute(p))throw Error('Неверная папка');const info=await fsp.lstat(p);if(!info.isDirectory()||info.isSymbolicLink())throw Error('Нужна обычная папка, не ссылка');const real=await fsp.realpath(p);if(norm(real)===norm(path.parse(real).root))throw Error('Нельзя использовать корень диска');return real}
async function digest(p){const hash=createHash('sha256');let size=0;for await(const chunk of fs.createReadStream(p)){hash.update(chunk);size+=chunk.length}return [size,hash.digest('hex')]}
async function inventory(root){const rows=[];let count=0,bytes=0;async function walk(dir,parts=[]){for(const name of (await fsp.readdir(dir)).sort()){const source=path.join(dir,name),info=await fsp.lstat(source),next=[...parts,name];if(info.isSymbolicLink())throw Error('Символические ссылки в сохранениях не поддерживаются: '+name);if(info.isDirectory()){rows.push(['d',next]);await walk(source,next)}else if(info.isFile()){const [size,hash]=await digest(source);rows.push(['f',next,size,hash]);count++;bytes+=size}else throw Error('Неподдерживаемый файл: '+name)}}await walk(root);return {fingerprint:createHash('sha256').update(JSON.stringify(rows)).digest('hex'),count,bytes}}
async function duplicate(from,to,expected){const before=await inventory(from);if(expected&&before.fingerprint!==expected)throw Error('Копия повреждена или изменена');await fsp.cp(from,to,{recursive:true,force:false,errorOnExist:true});const after=await inventory(to);if(before.fingerprint!==after.fingerprint)throw Error('Файлы изменились при копировании — повторите с закрытой игрой');return after}
async function snapshot(source,base){const origin=await directory(source);await fsp.mkdir(base,{recursive:true});const root=await directory(base);if(inside(origin,root)||inside(root,origin))throw Error('Папки сохранений и хранилища пересекаются');const outer=await fsp.mkdtemp(path.join(root,'save-')),target=path.join(outer,'files');try{return {path:target,source:origin,...await duplicate(origin,target)}}catch(e){await fsp.rm(outer,{recursive:true,force:true});throw e}}
async function exportCopy(record,parent){const from=await directory(record.path),dest=await directory(parent);if(inside(from,dest))throw Error('Нельзя сохранять копию внутрь неё самой');const outer=await fsp.mkdtemp(path.join(dest,'Nexora-restored-')),target=path.join(outer,'files');try{return {path:target,...await duplicate(from,target,record.fingerprint)}}catch(e){await fsp.rm(outer,{recursive:true,force:true});throw e}}
async function restoreOriginal(record,vaultRoot){
 if(!record.source||!record.fingerprint)throw Error('Для старых копий доступно только извлечение в отдельную папку');
 const from=await directory(record.path),origin=await directory(record.source),vault=await directory(vaultRoot);
 if(!inside(vault,from)||inside(vault,origin)||inside(origin,vault)||inside(from,origin)||inside(origin,from))throw Error('Исходная папка пересекается с хранилищем');
 if(norm(path.resolve(record.source))!==norm(origin))throw Error('Путь исходной папки изменился; используйте извлечение');
 const parent=path.dirname(origin),work=await fsp.mkdtemp(path.join(parent,'.nexora-restore-')),staged=path.join(work,'incoming'),previous=path.join(work,'previous');
 let moved=false;
 try{const meta=await duplicate(from,staged,record.fingerprint);await inventory(origin);await fsp.rename(origin,previous);moved=true;try{await fsp.rename(staged,origin)}catch(error){try{await fsp.rename(previous,origin);moved=false}catch{throw Error('Не удалось вернуть исходные файлы. Они сохранены в '+previous)}throw error}return {path:origin,previous,...meta}
 }catch(e){if(!moved)await fsp.rm(work,{recursive:true,force:true});throw e}
}
module.exports={snapshot,exportCopy,restoreOriginal,inventory,inside};
