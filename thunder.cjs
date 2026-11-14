const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{createHash}=require('node:crypto'),{Readable,Transform}=require('node:stream'),{pipeline}=require('node:stream/promises');
const games=[['valheim','Valheim'],['lethal-company','Lethal Company'],['riskofrain2','Risk of Rain 2'],['repo','R.E.P.O.'],['ultrakill','ULTRAKILL']];
const base='https://thunderstore.io',MAX=256*1024*1024,MAX_JSON=128*1024*1024,agent='WellJons/Nexora/0.11.0';
function community(s){if(!games.some(([id])=>id===s))throw Error('Неизвестная игра');return s}
const token=v=>typeof v==='string'&&/^[A-Za-z0-9_]{1,128}$/.test(v);
const version=v=>typeof v==='string'&&/^\d{1,10}\.\d{1,10}\.\d{1,10}$/.test(v);
function safeUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&['thunderstore.io','gcdn.thunderstore.io','cdn.thunderstore.io'].includes(u.hostname)?u:null}catch{return null}}
function trim(v,n){return typeof v==='string'?v.slice(0,n):''}
function normalize(p){
 if(!token(p?.owner)||!token(p.name)||p.is_deprecated||p.has_nsfw_content)return null;
 const versions=(Array.isArray(p.versions)?p.versions:[]).filter(v=>v.is_active!==false&&version(v.version_number)&&Number.isSafeInteger(v.file_size)&&v.file_size>0&&v.file_size<=MAX).slice(0,30).map(v=>({version:v.version_number,description:trim(v.description,600),size:v.file_size,downloads:Number.isFinite(v.downloads)?Math.max(0,v.downloads):0,dependencies:(Array.isArray(v.dependencies)?v.dependencies:[]).filter(x=>typeof x==='string').slice(0,100).map(x=>x.slice(0,290))}));
 if(!versions.length)return null;
 return {id:p.owner+'-'+p.name,owner:p.owner,name:p.name,description:versions[0].description,downloads:versions.reduce((a,v)=>a+v.downloads,0),rating:Number.isFinite(p.rating_score)?p.rating_score:0,updated:trim(p.date_updated,40),categories:(Array.isArray(p.categories)?p.categories:[]).map(x=>trim(x,80)).slice(0,20),versions};
}
async function readJson(response){
 if(!response.ok||!response.body)throw Error('Thunderstore: HTTP '+response.status);
 const rd=response.body.getReader(),chunks=[];let count=0;try{while(true){const {done,value}=await rd.read();if(done)break;count+=value.length;if(count>MAX_JSON)throw Error('Каталог слишком большой');chunks.push(Buffer.from(value))}}finally{await rd.cancel().catch(()=>{});rd.releaseLock()}
 return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function createThunder(fetcher=fetch,clock=Date.now){
 let cache=null,pending=null;
 async function get(game){community(game);if(cache?.game===game&&clock()-cache.at<300000)return cache.rows;if(pending){if(pending.game===game)return pending.promise;throw Error('Дождитесь загрузки другого каталога')}
 const promise=(async()=>{const res=await fetcher(base+'/c/'+game+'/api/v1/package/',{headers:{'User-Agent':agent,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(90000)});const raw=await readJson(res);if(!Array.isArray(raw))throw Error('Неожиданный формат каталога');const rows=raw.map(normalize).filter(Boolean);cache={game,at:clock(),rows};return rows})();pending={game,promise};try{return await promise}finally{pending=null}}
 async function search(game,q,sort,page){if(typeof q!=='string'||q.length>100||!['popular','recent','rating'].includes(sort)||!Number.isSafeInteger(page)||page<0||page>10000)throw Error('Некорректный поиск');const rows=await get(game),needle=q.trim().toLowerCase();const filtered=rows.filter(p=>!needle||[p.name,p.owner,p.description,...p.categories].some(v=>v.toLowerCase().includes(needle)));filtered.sort((a,b)=>sort==='rating'?b.rating-a.rating:sort==='recent'?Date.parse(b.updated)-Date.parse(a.updated):b.downloads-a.downloads);return {total:filtered.length,items:filtered.slice(page*24,page*24+24).map(({versions,...p})=>({...p,latest:versions[0].version}))}}
 async function details(game,id){if(typeof id!=='string'||id.length>260)throw Error('Некорректный пакет');const p=(await get(game)).find(x=>x.id===id);if(!p)throw Error('Пакет не найден');return p}
 async function download(game,id,v,dest){const p=await details(game,id),meta=p.versions.find(x=>x.version===v);if(!meta)throw Error('Версия недоступна');if(path.extname(dest).toLowerCase()!=='.zip')throw Error('Выберите ZIP');let url=new URL('/package/download/'+p.owner+'/'+p.name+'/'+meta.version+'/',base),res;
 for(let n=0;n<5;n++){if(!safeUrl(url.href))throw Error('Недоверенный адрес загрузки');res=await fetcher(url,{headers:{'User-Agent':agent},redirect:'manual',signal:AbortSignal.timeout(180000)});if(![301,302,303,307,308].includes(res.status))break;const loc=res.headers.get('location');await res.body?.cancel();if(!loc)throw Error('Отсутствует адрес перенаправления');url=new URL(loc,url);res=null}
 if(!res?.ok||!res.body)throw Error('Ошибка загрузки Thunderstore');
 const tmp=await fs.promises.mkdtemp(path.join(os.tmpdir(),'nexora-thunder-')),staged=path.join(tmp,'package.zip');let size=0,head=Buffer.alloc(0);const hash=createHash('sha256');
 try{const guard=new Transform({transform(chunk,_enc,cb){size+=chunk.length;if(size>MAX||size>meta.size)return cb(Error('Размер превышает заявленный'));if(head.length<4)head=Buffer.concat([head,chunk.subarray(0,4-head.length)]);hash.update(chunk);cb(null,chunk)}});await pipeline(Readable.fromWeb(res.body),guard,fs.createWriteStream(staged,{flags:'wx'}));if(size!==meta.size||head.toString('hex')!=='504b0304')throw Error('Размер или формат ZIP не совпадает');await fs.promises.copyFile(staged,dest,fs.constants.COPYFILE_EXCL);return {size,sha256:hash.digest('hex'),name:path.basename(dest)}}finally{await fs.promises.rm(tmp,{recursive:true,force:true})}
 }
 return {search,details,download};
}
module.exports={games,normalize,safeUrl,createThunder};
