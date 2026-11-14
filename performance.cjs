const os=require('node:os');
function number(v,min,max){return typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max?v:null}
function percent(v){return number(v,0,100)}
function temperature(v){return number(v,1,150)}
function text(v){return typeof v==='string'?v.slice(0,180):''}
function normalize({load={},mem={},temperature:temp={},graphics={},cpu={},now=Date.now()}={}){
 const total=number(mem.total,1,Number.MAX_SAFE_INTEGER),available=total===null?null:number(mem.available,0,total);
 const used=total!==null&&available!==null?total-available:null;
 return {at:now,cpu:{name:[text(cpu.manufacturer),text(cpu.brand)].filter(Boolean).join(' ')||os.cpus()[0]?.model||'CPU',cores:number(cpu.cores,1,4096),load:percent(load.currentLoad),temperature:temperature(temp.main)},ram:{total,used,load:used===null?null:Math.round(used/total*1000)/10},gpus:(Array.isArray(graphics.controllers)?graphics.controllers:[]).slice(0,8).map(g=>({name:text(g.model)||text(g.name)||'GPU',load:percent(g.utilizationGpu),temperature:temperature(g.temperatureGpu),vramTotal:number(g.memoryTotal,1,1048576)??number(g.vram,1,1048576),vramUsed:number(g.memoryUsed,0,1048576)}))};
}
function makeMonitor(si,clock=Date.now){
 let last=null,pending=null,cpu=null;
 async function safe(fn){try{return await fn()||{}}catch{return {}}}
 async function sample(){if(pending)return pending;if(last&&clock()-last.at<2500)return last;
 pending=(async()=>{const [load,mem,temp,graphics,info]=await Promise.all([safe(()=>si.currentLoad()),safe(()=>si.mem()),safe(()=>si.cpuTemperature()),safe(()=>si.graphics()),cpu?Promise.resolve(cpu):safe(()=>si.cpu())]);if(info.brand)cpu=info;last=normalize({load,mem,temperature:temp,graphics,cpu:info,now:clock()});return last})();try{return await pending}finally{pending=null}}
 return {sample};
}
module.exports={normalize,makeMonitor};
