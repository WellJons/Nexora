const {parentPort,workerData}=require('node:worker_threads'),path=require('node:path'),os=require('node:os');
const options=workerData.options||{dtype:'q8',threads:2,maxTokens:256};const threads=Math.max(1,Math.min(options.threads,Math.max(1,os.availableParallelism()-2)));
let model=null;
async function get(){if(model)return model;
 const {pipeline,env}=await import('@huggingface/transformers');env.allowRemoteModels=false;env.allowLocalModels=true;env.useFSCache=false;env.useBrowserCache=false;env.localModelPath=path.dirname(workerData.folder)+path.sep;
 // No remote fallback: locally installed data only. CPU provider, bounded thread count.
 model=await pipeline('translation',path.basename(workerData.folder),{device:'cpu',dtype:options.dtype,local_files_only:true,session_options:{intraOpNumThreads:threads,interOpNumThreads:1,executionMode:'sequential'}});
 return model
}
parentPort.on('message',async m=>{try{if(m.op!=='translate'||typeof m.text!=='string'||!m.text.trim()||m.text.length>1000)throw Error('Некорректный текст');const pipe=await get();
 const result=await pipe(m.text,{num_beams:1,do_sample:false,max_new_tokens:Math.min(options.maxTokens,Math.max(32,Math.ceil(m.text.length*.95)))});
 const out=result?.[0]?.translation_text;if(typeof out!=='string'||!out.trim())throw Error('Пустой локальный перевод');parentPort.postMessage({ok:true,value:out.slice(0,3000)})
 }catch(e){parentPort.postMessage({ok:false,error:String(e.message||e).slice(0,400)})}});
