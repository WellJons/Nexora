// Community tables are downloaded as data solely to preview labels, never executed.
const {downloadPreview,downloadTable}=require('./ct-preview.cjs');
const fs=require('node:fs/promises'),path=require('node:path');
const SOURCE='bbfox0703/Mydev-Cheat-Engine-Tables',FALLBACK='sugirukun/Cheat-Engine-Tables',BRANCH='main',MAX=4*1024*1024,TTL=6*60*60*1000;
const SOURCES=Object.freeze([SOURCE,FALLBACK]);
const api=source=>'https://api.github.com/repos/'+source+'/git/trees/'+BRANCH+'?recursive=1';
function norm(s){return String(s||'').replace(/[™®©]/g,'').normalize('NFKC').toLowerCase().replace(/[’']/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim()}
function validateTree(v){if(!v||v.truncated!==false||!Array.isArray(v.tree)||v.tree.length>20000)throw Error('Неполный индекс источника');return v.tree.filter(x=>x?.type==='blob'&&typeof x.path==='string'&&x.path.length<=350&&/\.ct$/i.test(x.path)&&x.path.split('/').length>=2&&!x.path.split('/').some(p=>!p||p==='.'||p==='..'||/[\x00-\x1f\\]/.test(p))).map(x=>({path:x.path,title:x.path.split('/')[0],sha:/^[a-f0-9]{40}$/.test(x.sha||'')?x.sha:null,size:Number.isSafeInteger(x.size)?x.size:null}))}
function matchRows(rows,game,source=SOURCE){if(!SOURCES.includes(source))throw Error('Неизвестный источник');const wanted=norm(game?.name);if(wanted.length<3)return [];return rows.filter(r=>norm(r.title)===wanted).slice(0,12).map(r=>({title:r.title,file:r.path.split('/').at(-1),path:r.path,source,status:'metadata-only',sha:r.sha,size:r.size}))}
function sourceUrl(file,source=SOURCE){if(!SOURCES.includes(source))throw Error('Неизвестный источник');return 'https://github.com/'+source+'/blob/'+BRANCH+'/'+file.split('/').map(encodeURIComponent).join('/')}
async function bounded(r){if(!r.ok||!r.body)throw Error('GitHub HTTP '+r.status);const reader=r.body.getReader();let n=0;const chunks=[];try{while(true){const {done,value}=await reader.read();if(done)break;n+=value.byteLength;if(n>MAX)throw Error('Индекс слишком большой');chunks.push(Buffer.from(value))}return JSON.parse(Buffer.concat(chunks).toString('utf8'))}finally{await reader.cancel().catch(()=>{});reader.releaseLock()}}
function createDiscovery({root,match,details,sync,fetcher=fetch,clock=Date.now}){
 let index=null,indexSource=null,at=0,loaded=false,pending=null,lastSync=-Infinity,syncPending=null;const results=new Map(),previews=new Map(),previewPending=new Map();
 const cache=path.join(root,'trainer-source-index-v2.json');
 async function load(){if(loaded)return;loaded=true;try{const st=await fs.lstat(cache);if(!st.isFile()||st.isSymbolicLink()||st.size>MAX)return;const obj=JSON.parse(await fs.readFile(cache,'utf8'));if(SOURCES.includes(obj.source)&&Number.isFinite(obj.at)&&obj.at<=clock()&&obj.at>=0){index=validateTree(obj.raw);indexSource=obj.source;at=obj.at}}catch{}}
 async function getIndex(force=false){if(pending)return pending;pending=(async()=>{
  await load();if(index&&!force&&clock()-at<TTL)return {rows:index,source:indexSource,cached:true,fallback:indexSource!==SOURCE};
  let error;
  for(const source of SOURCES){try{
    const raw=await bounded(await fetcher(api(source),{redirect:'error',signal:AbortSignal.timeout(10000),headers:{Accept:'application/vnd.github+json','User-Agent':'Nexora'}}));
    const next=validateTree(raw);index=next;indexSource=source;at=clock();
    const tmp=cache+'.tmp';try{await fs.writeFile(tmp,JSON.stringify({at,source,raw}),{flag:'wx'});await fs.rename(tmp,cache)}catch{}finally{await fs.rm(tmp,{force:true}).catch(()=>{})}
    return {rows:index,source,cached:false,fallback:source!==SOURCE};
  }catch(e){error=e}}
  if(index)return {rows:index,source:indexSource,cached:true,stale:true,fallback:indexSource!==SOURCE};
  throw error||Error('Источники недоступны')
 })();try{return await pending}finally{pending=null}}
 async function localSync(force){if(syncPending)return syncPending;if(!force&&clock()-lastSync<60000)return;lastSync=clock();syncPending=Promise.resolve().then(sync);try{await syncPending}finally{syncPending=null}}
 async function getPreview(row){if(!row.sha)throw Error('Индекс без контрольной суммы. Обновите каталог.');if(previews.has(row.sha))return previews.get(row.sha);if(previewPending.has(row.sha))return previewPending.get(row.sha);const p=downloadPreview(row,{source:row.source,branch:BRANCH,fetcher}).then(v=>{previews.set(row.sha,v);if(previews.size>40)previews.delete(previews.keys().next().value);return v});previewPending.set(row.sha,p);try{return await p}finally{previewPending.delete(row.sha)}}
 async function prepare(game,{online=true,force=false,includeCommunity=false}={}){let syncError='',sourceError='',candidates=[],cached=false,stale=false,source=null,fallback=false;
  if(online){try{await localSync(force)}catch(e){syncError=String(e.message||e).slice(0,160)}}
  const id=match(game),profile=id?details(id):null;
  if(online&&(!profile||force||includeCommunity)){try{const result=await getIndex(force);source=result.source;fallback=!!result.fallback;candidates=matchRows(result.rows,game,source);cached=result.cached;stale=!!result.stale}catch(e){sourceError=String(e.message||e).slice(0,160)}}
  const result={gameId:game.id,profileId:id||null,status:profile?'ready':candidates.length?'found':!online?'offline':sourceError?'unavailable':'missing',engine:profile?.engine||null,candidates,cached,stale,source,fallback,syncError,sourceError};
  if(online&&candidates.length===1&&candidates[0].sha){try{candidates[0].preview=await getPreview(candidates[0]);candidates[0].status='preview-only'}catch(e){candidates[0].previewError=String(e.message||e).slice(0,180)}}
  results.set(game.id,result);if(results.size>100)results.delete(results.keys().next().value);return result
 }
 return {prepare,download:async(id,file)=>{const result=results.get(id),row=result?.candidates.find(c=>c.path===file);if(!row||!row.sha)throw Error('Таблица не найдена в текущем индексе');const bytes=await downloadTable(row,{source:row.source,branch:BRANCH,fetcher});return {bytes,source:sourceUrl(row.path,row.source),file:row.file}},preview:async(id,file)=>{const result=results.get(id),row=result?.candidates.find(c=>c.path===file);if(!row)throw Error('Источник не найден');row.preview=await getPreview(row);row.status='preview-only';delete row.previewError;return result},get:id=>results.get(id)||null,url:(id,file)=>{const row=results.get(id)?.candidates.find(c=>c.path===file);if(!row)throw Error('Источник не найден');return sourceUrl(row.path,row.source)}}
}
module.exports={createDiscovery,norm,validateTree,matchRows,sourceUrl,SOURCES};
