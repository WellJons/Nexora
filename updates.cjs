const BASE='https://github.com/WellJons/Nexora/releases';
const API='https://api.github.com/repos/WellJons/Nexora/releases?per_page=20';
function parts(v){if(typeof v!=='string'||!/^v?\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(v))return null;return v.replace(/^v/,'').split('.').map(Number)}
function compare(a,b){const x=parts(a),y=parts(b);if(!x||!y)throw Error('Invalid version');for(let i=0;i<3;i++)if(x[i]!==y[i])return Math.sign(x[i]-y[i]);return 0}
function selectRelease(rows,current){
 if(!Array.isArray(rows)||!parts(current))throw Error('Некорректный ответ GitHub');
 const candidates=rows.filter(r=>r&&!r.draft&&parts(r.tag_name)).map(r=>{
  const version=r.tag_name.replace(/^v/,''),name='Nexora-Setup-'+version+'-x64.exe',page=BASE+'/tag/'+r.tag_name,asset=BASE+'/download/'+r.tag_name+'/'+name;
  const files=Array.isArray(r.assets)?r.assets:[],setup=files.find(x=>x.name===name&&x.browser_download_url===asset&&Number.isSafeInteger(x.size)&&x.size>0),checksum=files.find(x=>x.name===name+'.sha256'&&x.browser_download_url===asset+'.sha256');
  return {version,page,asset,shaUrl:asset+'.sha256',name,prerelease:!!r.prerelease,installer:!!setup&&!!checksum,size:setup?.size||0,notes:typeof r.body==='string'?r.body.slice(0,5000):''}
 }).filter(r=>r.installer).sort((a,b)=>compare(b.version,a.version));
 const latest=candidates[0];return {current,latest:latest||null,available:!!latest&&compare(latest.version,current)>0,releasePage:BASE,checkedAt:new Date().toISOString()};
}
async function boundedJson(response,limit=1024*1024){if(!response.ok||!response.body)throw Error('GitHub: HTTP '+response.status);let total=0;const rows=[];const reader=response.body.getReader();try{while(true){const {value,done}=await reader.read();if(done)break;total+=value.byteLength;if(total>limit)throw Error('Ответ GitHub слишком большой');rows.push(Buffer.from(value))}}finally{await reader.cancel().catch(()=>{});reader.releaseLock()}return JSON.parse(Buffer.concat(rows).toString('utf8'))}
function createUpdates(current,fetcher=fetch,clock=Date.now){let cache=null,pending=null,at=0;
 async function check(){if(cache&&clock()-at<60000)return cache;if(pending)return pending;pending=(async()=>{const res=await fetcher(API,{headers:{Accept:'application/vnd.github+json','User-Agent':'Nexora/'+current},redirect:'error',signal:AbortSignal.timeout(15000)});cache=selectRelease(await boundedJson(res),current);at=clock();return cache})();try{return await pending}finally{pending=null}}
 return {check,page:()=>cache?.latest?.page||BASE};
}
module.exports={compare,selectRelease,boundedJson,createUpdates};
