const $=id=>document.getElementById(id);
const valid=v=>typeof v==='number'&&Number.isFinite(v);
const fmt=(v,s)=>valid(v)?Math.round(v)+s:'—';
function set(id,value){$(id).textContent=value}
function bar(id,v){$(id).value=valid(v)?v:0}
let busy=false;
async function poll(){if(busy||document.hidden)return;busy=true;try{const s=await window.hud.sample();if(!s)return;const g=s.gpus.find(x=>valid(x.load))||s.gpus[0]||{};set('cpu',fmt(s.cpu.load,'%'));set('ct',fmt(s.cpu.temperature,'°C'));bar('cp',s.cpu.load);set('gpu',fmt(g.load,'%'));set('gt',fmt(g.temperature,'°C'));bar('gp',g.load);set('ram',fmt(s.ram.load,'%'));set('rt',valid(s.ram.used)?(s.ram.used/1073741824).toFixed(1)+' ГБ':'—');bar('rp',s.ram.load);set('device',g.name||s.cpu.name);set('clock',new Date(s.at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}))}catch{set('clock','Нет данных')}finally{busy=false}}
poll();setInterval(poll,3000);document.addEventListener('visibilitychange',poll);
