const fs=require('node:fs'),path=require('node:path'),{Worker}=require('node:worker_threads'),{createHash}=require('node:crypto'),{Readable,Transform}=require('node:stream'),{pipeline}=require('node:stream/promises');
const MODEL='onnx-community/opus-mt-en-ru',REV='c6967b328d292f9f3d14bab6e9de40f9bd367114';
const FILES=[
 ['config.json',65536],['generation_config.json',65536],['tokenizer_config.json',65536],['tokenizer.json',16*1024*1024],['special_tokens_map.json',65536],['vocab.json',8*1024*1024],['README.md',65536],
 ['onnx/encoder_model_quantized.onnx',60*1024*1024,'b8b4f72528c0da92e579af8a739f97fa2f792d73527ba2fee786fa7286c4055b'],
 ['onnx/decoder_model_merged_quantized.onnx',200*1024*1024,'5d15c48566e60dcaa5af7422bcceca24ccc8f3eaa8f1b3aedc5d6170e6c232f3']
];
const FULL_FILES=[...FILES.slice(0,-2),
 ['onnx/encoder_model.onnx',220*1024*1024,'a981e3d774142cb7445e7d9eeda1b56bc415f068dd25ba688c908092f63b1174'],
 ['onnx/decoder_model_merged.onnx',250*1024*1024,'a5f0f76b1f825f6c9bc06b507e3e9617ee18fe2bdea07debdea7505e9d9f9f3b']
];
const M2M_MODEL='Xenova/m2m100_418M',M2M_REV='9c374f0';
const M2M_FILES=[...FILES.slice(0,-2),
 ['onnx/encoder_model_quantized.onnx',300*1024*1024,'13a94e354a9140764eb81102d77d3ec6952d796e6f113c651eeb3c3443da0386'],
 ['onnx/decoder_model_merged_quantized.onnx',350*1024*1024,'007654bcabb6cea6fd3bde34ce933137b431330b3755781145d7b6906270b45a']
];
const PROFILES=Object.freeze({
 lite:Object.freeze({pack:'q8',dtype:'q8',threads:2,blocks:5,width:1920,height:1080,maxTokens:256}),
 balanced:Object.freeze({pack:'q8',dtype:'q8',threads:4,blocks:8,width:1920,height:1080,maxTokens:384}),
 quality:Object.freeze({pack:'fp32',dtype:'fp32',threads:6,blocks:10,width:2560,height:1440,maxTokens:512,disableOptimizations:true}),
 advanced:Object.freeze({pack:'m2m',dtype:'q8',threads:6,blocks:8,width:2560,height:1440,maxTokens:512,src:'en',tgt:'ru'})
});
function profile(id='balanced'){if(!Object.hasOwn(PROFILES,id))throw Error('Неизвестный профиль перевода');return PROFILES[id]}
function packFiles(pack){if(pack==='q8')return FILES;if(pack==='fp32')return FULL_FILES;if(pack==='m2m')return M2M_FILES;throw Error('Неизвестный языковой пакет')}
function packSource(pack){packFiles(pack);return pack==='m2m'?{model:M2M_MODEL,revision:M2M_REV}:{model:MODEL,revision:REV}}
function trusted(url){return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&(url.hostname==='huggingface.co'||url.hostname.endsWith('.huggingface.co')||url.hostname.endsWith('.hf.co'))}
async function downloadFile(entry,folder,signal,onBytes=()=>{},fetcher=fetch,pack='q8'){
 const {model,revision}=packSource(pack);const [name,max,digest]=entry;let url=new URL('https://huggingface.co/'+model+'/resolve/'+revision+'/'+name),res;
 for(let i=0;i<6;i++){if(!trusted(url))throw Error('Недоверенный адрес пакета');res=await fetcher(url,{redirect:'manual',signal:AbortSignal.any([signal,AbortSignal.timeout(600000)])});if(![301,302,303,307,308].includes(res.status))break;const loc=res.headers.get('location');await res.body?.cancel();if(!loc)throw Error('Нет адреса загрузки');url=new URL(loc,url);res=null}
 if(!res?.ok||!res.body)throw Error('Языковой пакет: HTTP '+(res?.status||'redirect'));
 const out=path.join(folder,name);await fs.promises.mkdir(path.dirname(out),{recursive:true});const hash=createHash('sha256');let size=0;
 const guard=new Transform({transform(chunk,_e,cb){size+=chunk.length;if(size>max)return cb(Error('Файл превышает ограничение размера'));hash.update(chunk);onBytes(size);cb(null,chunk)}});
 await pipeline(Readable.fromWeb(res.body),guard,fs.createWriteStream(out,{flags:'wx'}),{signal});
 const actual=hash.digest('hex');if(!size||digest&&digest!==actual)throw Error('Контрольная сумма модели не совпадает: '+name);
 if(name.endsWith('.json'))JSON.parse(await fs.promises.readFile(out,'utf8'));return {name,size,sha256:actual}
}
function ready(folder,pack='q8'){try{const m=JSON.parse(fs.readFileSync(path.join(folder,'installed.json'),'utf8'));return m.revision===packSource(pack).revision&&packFiles(pack).every(([name,max])=>{const p=path.join(folder,name),s=fs.statSync(p),r=m.files.find(x=>x.name===name);return s.isFile()&&s.size>0&&s.size<=max&&s.size===r?.size})}catch{return false}}
function createEngine(folder,profileId='balanced'){
 const options=profile(profileId);
 let worker=null,pending=null;
 function finish(e,value){if(!pending)return;const p=pending;pending=null;clearTimeout(p.timer);p.signal?.removeEventListener('abort',p.abort);e?p.reject(e):p.resolve(value)}
 function close(reason='Локальный перевод остановлен'){const w=worker;worker=null;finish(Error(reason));return w?w.terminate().catch(()=>{}):Promise.resolve()}
 function request(op,text,signal){if(signal?.aborted)return Promise.reject(Error('Отменено'));if(pending)return Promise.reject(Error('Локальная модель занята'));
  if(!worker){const w=new Worker(path.join(__dirname,'local-model-worker.cjs'),{workerData:{folder,options}});worker=w;w.on('message',m=>{if(worker===w)finish(m.ok?null:Error(m.error||'Ошибка модели'),m.value)});w.on('error',e=>{if(worker===w)close(e.message)});w.on('exit',()=>{if(worker===w)close('Процесс модели завершился')})}
  return new Promise((resolve,reject)=>{const abort=()=>close('Перевод отменён');pending={resolve,reject,signal,abort,timer:setTimeout(()=>close('Превышено время работы модели'),120000)};signal?.addEventListener('abort',abort,{once:true});worker.postMessage({op,text})})
 }
 return {translate:(text,signal)=>request('translate',text,signal),close};
}
function createLocalModel(root,onChange=()=>{}){
 const folder=pack=>path.join(root,'en-ru-'+pack+'-'+packSource(pack).revision.slice(0,7));let controller=null,engine=null,operation=null,engineProfile=null;
 let status={installing:false,downloaded:0,file:'',error:'',pack:null};
 function state(){return {...status,ready:ready(folder('q8')),packs:{q8:ready(folder('q8'),'q8'),fp32:ready(folder('fp32'),'fp32'),m2m:ready(folder('m2m'),'m2m')}}}
 function publish(patch){status={...status,...patch};const v=state();onChange(v);return v}
 async function install(pack='q8'){const entries=packFiles(pack),target=folder(pack);if(operation)throw Error('Установка уже выполняется');if(ready(target,pack))return publish({error:''});
  controller=new AbortController();const signal=controller.signal;publish({installing:true,downloaded:0,file:'',error:'',pack});
  operation=(async()=>{await fs.promises.mkdir(root,{recursive:true});const stage=await fs.promises.mkdtemp(path.join(root,'download-'));let completed=0,lastProgress=0;const manifest=[];let probe=null;
   try{for(const entry of entries){publish({file:entry[0]});const row=await downloadFile(entry,stage,signal,n=>{const now=Date.now();if(now-lastProgress>=300){lastProgress=now;publish({downloaded:completed+n})}},fetch,pack);completed+=row.size;publish({downloaded:completed});manifest.push(row)}
    publish({file:'Проверка локального перевода'});probe=createEngine(stage,pack==='m2m'?'advanced':pack==='fp32'?'quality':'lite');const text=await probe.translate('Hello world.',signal);if(!/[а-яё]/i.test(text))throw Error('Тест локального перевода не пройден');await probe.close();probe=null;
    await fs.promises.writeFile(path.join(stage,'installed.json'),JSON.stringify({revision:packSource(pack).revision,pack,files:manifest}));
    if(signal.aborted)throw Error('Отменено');if(fs.existsSync(target)){if(ready(target,pack))return state();throw Error('Повреждённая папка модели: '+target)}
    await fs.promises.rename(stage,target);return publish({downloaded:completed,file:'Готово'});
   }finally{await probe?.close();await fs.promises.rm(stage,{recursive:true,force:true})}
  })();try{await operation}catch(e){publish({error:signal.aborted?'Загрузка отменена':String(e.message||e).slice(0,250)})}finally{operation=null;controller=null;publish({installing:false})}return state()
 }
 function cancel(){controller?.abort();return state()}
 async function translate(text,signal,profileId='balanced'){const p=profile(profileId);if(!ready(folder(p.pack),p.pack))throw Error('Сначала скачайте выбранный языковой пакет');if(operation)throw Error('Языковой пакет ещё устанавливается');if(engine&&engineProfile!==profileId)await close();if(!engine){engine=createEngine(folder(p.pack),profileId);engineProfile=profileId}return engine.translate(text,signal)}
 function close(){const e=engine;engine=null;engineProfile=null;return e?.close()||Promise.resolve()}
 return {state,install,cancel,translate,close,isReady:id=>ready(folder(profile(id).pack),profile(id).pack)};
}
module.exports={MODEL,REV,FILES,FULL_FILES,M2M_FILES,PROFILES,profile,packFiles,packSource,downloadFile,trusted,ready,createEngine,createLocalModel};
