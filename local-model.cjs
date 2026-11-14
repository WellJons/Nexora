const fs=require('node:fs'),path=require('node:path'),{Worker}=require('node:worker_threads'),{createHash}=require('node:crypto'),{Readable,Transform}=require('node:stream'),{pipeline}=require('node:stream/promises');
const MODEL='onnx-community/opus-mt-en-ru',REV='c6967b328d292f9f3d14bab6e9de40f9bd367114';
const FILES=[
 ['config.json',65536],['generation_config.json',65536],['tokenizer_config.json',65536],['tokenizer.json',16*1024*1024],['special_tokens_map.json',65536],['vocab.json',8*1024*1024],['README.md',65536],
 ['onnx/encoder_model_quantized.onnx',60*1024*1024,'b8b4f72528c0da92e579af8a739f97fa2f792d73527ba2fee786fa7286c4055b'],
 ['onnx/decoder_model_merged_quantized.onnx',200*1024*1024,'5d15c48566e60dcaa5af7422bcceca24ccc8f3eaa8f1b3aedc5d6170e6c232f3']
];
function trusted(url){return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&(url.hostname==='huggingface.co'||url.hostname.endsWith('.huggingface.co')||url.hostname.endsWith('.hf.co'))}
async function downloadFile(entry,folder,signal,onBytes=()=>{},fetcher=fetch){
 const [name,max,digest]=entry;let url=new URL('https://huggingface.co/'+MODEL+'/resolve/'+REV+'/'+name),res;
 for(let i=0;i<6;i++){if(!trusted(url))throw Error('Недоверенный адрес пакета');res=await fetcher(url,{redirect:'manual',signal:AbortSignal.any([signal,AbortSignal.timeout(600000)])});if(![301,302,303,307,308].includes(res.status))break;const loc=res.headers.get('location');await res.body?.cancel();if(!loc)throw Error('Нет адреса загрузки');url=new URL(loc,url);res=null}
 if(!res?.ok||!res.body)throw Error('Языковой пакет: HTTP '+(res?.status||'redirect'));
 const out=path.join(folder,name);await fs.promises.mkdir(path.dirname(out),{recursive:true});const hash=createHash('sha256');let size=0;
 const guard=new Transform({transform(chunk,_e,cb){size+=chunk.length;if(size>max)return cb(Error('Файл превышает ограничение размера'));hash.update(chunk);onBytes(size);cb(null,chunk)}});
 await pipeline(Readable.fromWeb(res.body),guard,fs.createWriteStream(out,{flags:'wx'}),{signal});
 const actual=hash.digest('hex');if(!size||digest&&digest!==actual)throw Error('Контрольная сумма модели не совпадает: '+name);
 if(name.endsWith('.json'))JSON.parse(await fs.promises.readFile(out,'utf8'));return {name,size,sha256:actual}
}
function ready(folder){try{const m=JSON.parse(fs.readFileSync(path.join(folder,'installed.json'),'utf8'));return m.revision===REV&&FILES.every(([name,max])=>{const p=path.join(folder,name),s=fs.statSync(p),r=m.files.find(x=>x.name===name);return s.isFile()&&s.size>0&&s.size<=max&&s.size===r?.size})}catch{return false}}
function createEngine(folder){
 let worker=null,pending=null;
 function finish(e,value){if(!pending)return;const p=pending;pending=null;clearTimeout(p.timer);p.signal?.removeEventListener('abort',p.abort);e?p.reject(e):p.resolve(value)}
 function close(reason='Локальный перевод остановлен'){const w=worker;worker=null;finish(Error(reason));return w?w.terminate().catch(()=>{}):Promise.resolve()}
 function request(op,text,signal){if(signal?.aborted)return Promise.reject(Error('Отменено'));if(pending)return Promise.reject(Error('Локальная модель занята'));
  if(!worker){const w=new Worker(path.join(__dirname,'local-model-worker.cjs'),{workerData:{folder}});worker=w;w.on('message',m=>{if(worker===w)finish(m.ok?null:Error(m.error||'Ошибка модели'),m.value)});w.on('error',e=>{if(worker===w)close(e.message)});w.on('exit',()=>{if(worker===w)close('Процесс модели завершился')})}
  return new Promise((resolve,reject)=>{const abort=()=>close('Перевод отменён');pending={resolve,reject,signal,abort,timer:setTimeout(()=>close('Превышено время работы модели'),120000)};signal?.addEventListener('abort',abort,{once:true});worker.postMessage({op,text})})
 }
 return {translate:(text,signal)=>request('translate',text,signal),close};
}
function createLocalModel(root,onChange=()=>{}){
 const folder=path.join(root,'en-ru-q8-'+REV.slice(0,7));let controller=null,engine=null,operation=null;
 let state={ready:ready(folder),installing:false,downloaded:0,file:'',error:''};
 function publish(patch){state={...state,...patch};onChange({...state});return {...state}}
 async function install(){if(operation)throw Error('Установка уже выполняется');if(ready(folder))return publish({ready:true,error:''});
  controller=new AbortController();const signal=controller.signal;publish({installing:true,ready:false,downloaded:0,file:'',error:''});
  operation=(async()=>{await fs.promises.mkdir(root,{recursive:true});const stage=await fs.promises.mkdtemp(path.join(root,'download-'));let completed=0;const manifest=[];let probe=null;
   try{for(const entry of FILES){publish({file:entry[0]});const row=await downloadFile(entry,stage,signal,n=>publish({downloaded:completed+n}));completed+=row.size;manifest.push(row)}
    publish({file:'Проверка локального перевода'});probe=createEngine(stage);const text=await probe.translate('Hello world.',signal);if(!/[а-яё]/i.test(text))throw Error('Тест локального перевода не пройден');await probe.close();probe=null;
    await fs.promises.writeFile(path.join(stage,'installed.json'),JSON.stringify({revision:REV,files:manifest}));
    if(signal.aborted)throw Error('Отменено');if(fs.existsSync(folder)){if(ready(folder))return publish({ready:true});throw Error('Повреждённая папка модели: '+folder)}
    await fs.promises.rename(stage,folder);return publish({ready:true,downloaded:completed,file:'Готово'});
   }finally{await probe?.close();await fs.promises.rm(stage,{recursive:true,force:true})}
  })();try{await operation}catch(e){publish({error:signal.aborted?'Загрузка отменена':String(e.message||e).slice(0,250)})}finally{operation=null;controller=null;publish({installing:false,ready:ready(folder)})}return {...state}
 }
 function cancel(){controller?.abort();return {...state}}
 async function translate(text,signal){if(!ready(folder))throw Error('Сначала скачайте локальный языковой пакет');if(!engine)engine=createEngine(folder);return engine.translate(text,signal)}
 function close(){const e=engine;engine=null;return e?.close()||Promise.resolve()}
 return {state:()=>({...state,ready:ready(folder)}),install,cancel,translate,close};
}
module.exports={MODEL,REV,FILES,downloadFile,trusted,ready,createEngine,createLocalModel};
