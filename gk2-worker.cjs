const {parentPort,workerData}=require('node:worker_threads');const save=require('./gk2-save.cjs');
(async()=>{const {op,args}=workerData;const result=op==='open'?await save.openSave(...args):op==='export'?await save.exportSave(...args):(()=>{throw Error('Unknown operation')})();parentPort.postMessage({ok:true,result})})().catch(e=>parentPort.postMessage({ok:false,error:String(e.message||e)}));
