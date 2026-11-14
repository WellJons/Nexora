// Read-only previews of community Cheat Engine tables. Never evaluate XML, Lua, ASM, or addresses.
const {createHash}=require('node:crypto');
const LIMIT=2*1024*1024;
function blobHash(bytes){return createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex')}
function decode(s){return s.replace(/&(?:quot|apos|lt|gt|amp|#\d{1,7}|#x[0-9a-fA-F]{1,6});/g,e=>{const m={'&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>','&amp;':'&'};if(Object.hasOwn(m,e))return m[e];const n=e.startsWith('&#x')?parseInt(e.slice(3,-1),16):Number(e.slice(2,-1));return n>0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):'\uFFFD'}).replace(/[\x00-\x1f\x7f]/g,' ').trim().replace(/^"(.*)"$/,'$1').slice(0,180)}
function inspect(bytes){
 if(!Buffer.isBuffer(bytes)||bytes.length<16||bytes.length>LIMIT)throw Error('Недопустимый размер CT');
 const xml=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
 if(/<!DOCTYPE|<!ENTITY/i.test(xml)||!/<CheatTable(?:\s|>)/.test(xml)||!/<\/CheatTable\s*>\s*$/.test(xml))throw Error('Неподдерживаемый формат CT');
 const scripts=/<(?:LuaScript|AssemblerScript|AutoAssemblerScript|Forms)(?:\s|>)/i.test(xml)||/Auto Assembler Script/i.test(xml);
 // This is a label preview, not an XML interpreter. Remove comments, CDATA and script fields.
 const visible=xml.replace(/<!--[\s\S]*?-->/g,'').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g,'').replace(/<(LuaScript|AssemblerScript|AutoAssemblerScript|Forms)(?:\s[^>]*|)?>[\s\S]*?<\/\1\s*>/gi,'');
 const names=[];let total=0;const seen=new Set();
 for(const m of visible.matchAll(/<Description\s*>([^<]{0,1000})<\/Description\s*>/g)){const name=decode(m[1]);if(!name||seen.has(name))continue;seen.add(name);total++;if(names.length<100)names.push(name)}
 return {names,total,containsScripts:scripts,mode:'preview-only',verifiedCompatibility:false};
}
async function downloadTable(candidate,{source,branch,fetcher=fetch}){
 if(!candidate||!Number.isSafeInteger(candidate.size)||candidate.size<16||candidate.size>LIMIT||!/^[a-f0-9]{40}$/.test(candidate.sha||''))throw Error('Нет подходящей контрольной суммы или таблица слишком большая');
 if(typeof candidate.path!=='string'||!candidate.path.endsWith('.CT')&&!candidate.path.toLowerCase().endsWith('.ct')||candidate.path.split('/').some(x=>!x||x==='.'||x==='..'||/[\x00-\x1f\\]/.test(x)))throw Error('Неверный путь CT');
 const url='https://raw.githubusercontent.com/'+source+'/'+branch+'/'+candidate.path.split('/').map(encodeURIComponent).join('/');
 const r=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(12000)});if(!r.ok||!r.body)throw Error('Источник CT: HTTP '+r.status);
 const reader=r.body.getReader();let size=0;const parts=[];try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>candidate.size||size>LIMIT)throw Error('Размер CT изменился');parts.push(Buffer.from(value))}}finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
 const bytes=Buffer.concat(parts);if(bytes.length!==candidate.size||blobHash(bytes)!==candidate.sha)throw Error('Контрольная сумма CT не совпадает. Обновите каталог.');
 inspect(bytes);return bytes;
}
async function downloadPreview(candidate,options){const bytes=await downloadTable(candidate,options);return {...inspect(bytes),sha:candidate.sha,size:bytes.length}}
module.exports={inspect,blobHash,downloadTable,downloadPreview,LIMIT};
