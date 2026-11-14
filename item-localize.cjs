// Labels are derived only from item IDs already returned by the current inventory.
const known=Object.freeze({egg_chicken:'Куриное яйцо'});
function readable(id){return String(id).replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim()}
function matchItem(x,q){const norm=s=>String(s||'').toLowerCase().replaceAll('ё','е').replace(/[_-]+/g,' ').trim();return norm(q).split(/\s+/).filter(Boolean).every(t=>norm([x.id,x.name,x.ru].join(' ')).includes(t))}
function createLabels({translate,enabled,clock=Date.now}){const cache=new Map();async function label(ids,signal){const rows=[];for(const id of [...new Set(ids)].slice(0,40)){if(typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,120}$/.test(id))continue;if(Object.hasOwn(known,id)){rows.push({id,ru:known[id],approximate:false});continue}const c=cache.get(id);if(c){rows.push(c);continue}if(signal.aborted||!enabled())continue;try{const text=await translate(readable(id),signal);if(typeof text!=='string'||text.length>180||!/[а-яё]/i.test(text))continue;const r={id,ru:text.replace(/[\x00-\x1f\x7f]/g,' ').trim(),approximate:true};cache.set(id,r);if(cache.size>1200)cache.delete(cache.keys().next().value);rows.push(r)}catch(e){if(signal.aborted)break;throw e}}return rows}
return {label}}
module.exports={readable,matchItem,createLabels};
