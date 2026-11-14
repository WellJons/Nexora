const path=require('node:path'),fs=require('node:fs'),{createHash}=require('node:crypto');
const MAX_SESSION=30*60*1000;
function region(r){if(!r||!['x','y','w','h'].every(k=>typeof r[k]==='number'&&Number.isFinite(r[k]))||r.x<0||r.y<0||r.w<.08||r.h<.06||r.x+r.w>1.000001||r.y+r.h>1.000001)throw Error('Выберите корректную область экрана');return {x:r.x,y:r.y,w:r.w,h:r.h}}
function cropRect(r,size){r=region(r);const x=Math.floor(r.x*size.width),y=Math.floor(r.y*size.height);return {x,y,width:Math.min(size.width-x,Math.max(1,Math.round(r.w*size.width))),height:Math.min(size.height-y,Math.max(1,Math.round(r.h*size.height)))}}
function settings(v){if(!v||!Number.isSafeInteger(v.display)||!['mymemory','deepl','ocr'].includes(v.provider)||![2500,4000,6000].includes(v.interval))throw Error('Неверные настройки');const key=typeof v.key==='string'?v.key.trim():'';if(v.provider==='deepl'&&(!key||key.length>200||!/^[A-Za-z0-9:-]+$/.test(key)))throw Error('Введите действительный ключ DeepL');return {display:v.display,region:region(v.region),provider:v.provider,interval:v.interval,key:v.provider==='deepl'?key:''}}
function normalize(s){return String(s||'').replace(/\s+/g,' ').trim().slice(0,1000)}
function chunks(text,max=450){const words=text.split(/\s+/),result=[];let part='';for(const word of words){if(Buffer.byteLength(word)>max)throw Error('Слишком длинная строка OCR');const next=part?part+' '+word:word;if(Buffer.byteLength(next)>max){result.push(part);part=word}else part=next}if(part)result.push(part);return result}
function decode(s){return String(s).replace(/&(?:amp|lt|gt|quot|apos|#39|#x27);/g,x=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&#39;':"'",'&#x27;':"'"})[x])}
async function translate(text,config,signal,fetcher=fetch){if(config.provider==='ocr')return text;const timeout=AbortSignal.any([signal,AbortSignal.timeout(15000)]);
 if(config.provider==='deepl'){const host=config.key.endsWith(':fx')?'api-free.deepl.com':'api.deepl.com';const r=await fetcher('https://'+host+'/v2/translate',{method:'POST',headers:{Authorization:'DeepL-Auth-Key '+config.key,'Content-Type':'application/json'},body:JSON.stringify({text:[text],source_lang:'EN',target_lang:'RU'}),redirect:'error',signal:timeout});if(!r.ok)throw Error('DeepL: HTTP '+r.status);const j=await r.json();const out=j.translations?.[0]?.text;if(typeof out!=='string'||!out.trim())throw Error('Пустой ответ DeepL');return out.slice(0,3000)}
 const out=[];for(const part of chunks(text)){const query=new URLSearchParams({q:part,langpair:'en|ru'});const r=await fetcher('https://api.mymemory.translated.net/get?'+query,{redirect:'error',signal:timeout});if(!r.ok)throw Error('MyMemory: HTTP '+r.status);const j=await r.json();if(Number(j.responseStatus)!==200||typeof j.responseData?.translatedText!=='string')throw Error('MyMemory: лимит или ошибка сервиса');const t=decode(j.responseData.translatedText);if(/MYMEMORY WARNING|YOU USED ALL AVAILABLE/i.test(t))throw Error('MyMemory: исчерпан бесплатный лимит');out.push(t)}return out.join(' ').slice(0,3000)
}
function createOcr(){
 let worker=null,opening=null;
 async function get(){if(worker)return worker;if(opening)return opening;opening=(async()=>{const {createWorker,PSM}=require('tesseract.js');const langPath=path.join(__dirname,'node_modules','@tesseract.js-data','eng','4.0.0_best_int');if(!fs.existsSync(path.join(langPath,'eng.traineddata.gz')))throw Error('Не найден локальный пакет OCR');const w=await createWorker('eng',1,{langPath,cacheMethod:'none'});try{await w.setParameters({tessedit_pageseg_mode:PSM.SPARSE_TEXT});worker=w;return w}catch(e){await w.terminate();throw e}})();try{return await opening}finally{opening=null}}
 return {async recognize(buffer){const w=await get();const {data}=await w.recognize(buffer);return {text:data.text,confidence:data.confidence}},async close(){if(opening)await opening.catch(()=>{});const w=worker;worker=null;if(w)await w.terminate()}};
}
function createSession({capture,ocr,send,canCapture=()=>true,translateFn=translate,clock=Date.now}){
 let active=null,timer=null,job=null,closing=false;let state={running:false,status:'Готов к запуску',original:'',translation:'',provider:'ocr',requests:0,ocrCount:0,elapsed:0};
 function publish(patch){state={...state,...patch};send({...state});return state}
 function schedule(s){if(active===s)timer=setTimeout(()=>{timer=null;job=tick(s).finally(()=>{job=null;if(active===s)schedule(s)})},s.config.interval)}
 async function tick(s){try{
  if(clock()-s.start>=MAX_SESSION){stop('Сессия завершена по лимиту времени');return}
  if(!canCapture()){if(state.status!=='Пауза: вернитесь в игру')publish({status:'Пауза: вернитесь в игру',original:'',translation:''});s.lastHash=null;s.lastText='';return}
  const began=clock(),image=await capture(s.config);if(active!==s||!image)return;
  const hash=createHash('sha256').update(image).digest('hex');if(hash===s.lastHash)return;s.lastHash=hash;
  const result=await ocr.recognize(image);if(active!==s)return;const text=normalize(result.text);
  publish({ocrCount:state.ocrCount+1,elapsed:clock()-began});
  if(!text||result.confidence<43||!/[a-z]{2,}/i.test(text)){s.lastText='';publish({original:'',translation:'',status:'Ожидание читаемого текста'});return}
  if(text===s.lastText){publish({status:'Ожидание нового текста'});return}
  let out=s.cache.get(text);
  if(out===undefined){if(s.config.provider==='mymemory'&&s.chars+text.length>4500){stop('Исчерпан локальный лимит бесплатной сессии');return}if(s.config.provider!=='ocr'){s.chars+=text.length;publish({requests:state.requests+1,status:'Перевод…'})}
   out=await translateFn(text,s.config,s.abort.signal);if(active!==s)return;s.cache.set(text,out);if(s.cache.size>128)s.cache.delete(s.cache.keys().next().value)}
  s.lastText=text;s.failures=0;publish({original:text,translation:out,status:s.config.provider==='ocr'?'Текст распознан':'Перевод готов',elapsed:clock()-began});
 }catch(e){if(active!==s)return;s.failures++;s.lastHash=null;publish({status:String(e.message||e).slice(0,200)});if(s.failures>=3)stop('Перевод остановлен после повторных ошибок')}
 }
 function start(value){if(active||closing||job)throw Error('Предыдущая сессия ещё завершается');const config=settings(value);const s={config,start:clock(),cache:new Map(),abort:new AbortController(),lastHash:null,lastText:'',failures:0,chars:0};active=s;publish({running:true,status:'Переключитесь в игру',original:'',translation:'',provider:config.provider,requests:0,ocrCount:0,elapsed:0});schedule(s);return {...state}}
 function stop(reason='Сессия остановлена'){const s=active;active=null;if(timer){clearTimeout(timer);timer=null}if(s){s.abort.abort();s.config.key='';s.cache.clear()}publish({running:false,status:reason,original:'',translation:''});if(!closing){closing=true;Promise.resolve(job).catch(()=>{}).then(()=>ocr.close()).catch(()=>{}).finally(()=>{closing=false})}return {...state}}
 return {start,stop,state:()=>({...state})}
}
module.exports={region,cropRect,settings,normalize,chunks,translate,createOcr,createSession};
