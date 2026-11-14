const {scratch}=require('./scratch.cjs');
const fs=require('node:fs'), path=require('node:path'), os=require('node:os');
const {createHash}=require('node:crypto');
const {Readable,Transform}=require('node:stream');
const {pipeline}=require('node:stream/promises');
const API='https://api.modrinth.com/v2', MAX=256*1024*1024;
const agent='WellJons/Nexora/0.10.0 (https://github.com/WellJons/Nexora)';
function id(s){if(typeof s!=='string'||!/^[a-zA-Z0-9]{8}$/.test(s))throw Error('Неверный идентификатор Modrinth');return s}
function filters(q='',game='',loader=''){
 if([q,game,loader].some(v=>typeof v!=='string'||v.length>100))throw Error('Неверный фильтр');
 if(game&&!/^[a-zA-Z0-9._-]+$/.test(game))throw Error('Неверная версия Minecraft');
 if(loader&&!['fabric','forge','quilt','neoforge'].includes(loader))throw Error('Неизвестный загрузчик');
 const facets=[['project_type:mod']];if(game)facets.push(['versions:'+game]);if(loader)facets.push(['categories:'+loader]);
 return new URLSearchParams({query:q.trim(),limit:'24',index:q.trim()?'relevance':'downloads',facets:JSON.stringify(facets)});
}
async function json(route){const res=await fetch(API+route,{headers:{'User-Agent':agent,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(20000)});if(!res.ok)throw Error('Modrinth: HTTP '+res.status);return res.json()}
async function search(q,game,loader){const result=await json('/search?'+filters(q,game,loader));return result.hits.map(p=>({id:p.project_id,title:p.title,description:p.description,author:p.author,downloads:p.downloads,icon:icon(p.icon_url)}))}
function icon(value){try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='cdn.modrinth.com'&&!u.port&&!u.username&&!u.password?u.href:null}catch{return null}}
function validFile(f){return !!(f&&typeof f.filename==='string'&&f.filename.length<=180&&/^[^<>:"/\\|?*\x00-\x1f]+\.jar$/i.test(f.filename)&&!f.filename.endsWith(' ')&&typeof f.hashes?.sha512==='string'&&/^[a-f0-9]{128}$/i.test(f.hashes.sha512)&&Number.isSafeInteger(f.size)&&f.size>0&&f.size<=MAX&&icon(f.url))}
function versionView(v){const files=v.files.filter(validFile).map(f=>({name:f.filename,size:f.size,primary:!!f.primary}));return {id:v.id,name:v.name,number:v.version_number,gameVersions:v.game_versions,loaders:v.loaders,type:v.version_type,dependencies:(v.dependencies||[]).filter(d=>d.dependency_type==='required').length,files}}
async function versions(project,game,loader){filters('',game,loader);const qs=new URLSearchParams();if(game)qs.set('game_versions',JSON.stringify([game]));if(loader)qs.set('loaders',JSON.stringify([loader]));return (await json('/project/'+id(project)+'/version?'+qs)).map(versionView).filter(v=>v.files.length)}
async function resolveFile(project,version,name){const v=await json('/version/'+id(version));if(v.project_id!==id(project))throw Error('Версия не принадлежит выбранному моду');const f=v.files.find(x=>x.filename===name&&validFile(x));if(!f)throw Error('Файл недоступен или не соответствует правилам загрузки');return f}
async function download(f,destination,fetcher=fetch){
 if(!validFile(f))throw Error('Неподдерживаемый файл');
 const temp=await fs.promises.mkdtemp(path.join(scratch(),'nexora-mod-')), staged=path.join(temp,'download.jar');
 try{
 const res=await fetcher(f.url,{headers:{'User-Agent':agent},redirect:'error',signal:AbortSignal.timeout(180000)});if(!res.ok||!res.body)throw Error('Ошибка загрузки: HTTP '+res.status);
 const hash=createHash('sha512');let size=0;
 const guard=new Transform({transform(chunk,_enc,cb){size+=chunk.length;if(size>f.size||size>MAX)return cb(Error('Файл превышает заявленный размер'));hash.update(chunk);cb(null,chunk)}});
 await pipeline(Readable.fromWeb(res.body),guard,fs.createWriteStream(staged,{flags:'wx'}));
 if(size!==f.size||hash.digest('hex')!==f.hashes.sha512.toLowerCase())throw Error('Контрольная сумма или размер не совпадают');
 await fs.promises.copyFile(staged,destination,fs.constants.COPYFILE_EXCL);
 return {size,sha512:f.hashes.sha512};
 }finally{await fs.promises.rm(temp,{recursive:true,force:true})}
}
async function getVersion(version){return json('/version/'+id(version))}
async function getVersions(project,game,loader){filters('',game,loader);const qs=new URLSearchParams({game_versions:JSON.stringify([game]),loaders:JSON.stringify([loader])});return json('/project/'+id(project)+'/version?'+qs)}
module.exports={filters,validFile,search,versions,resolveFile,download,getVersion,getVersions};
