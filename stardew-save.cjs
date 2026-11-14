// Restricted XML scalar patcher, no game assets or third-party code. Never expands entities.
const fs=require('node:fs/promises'),path=require('node:path'),{createHash}=require('node:crypto');
const MAX=64*1024*1024,labels={money:'Деньги (золото)',health:'Здоровье',maxHealth:'Максимальное здоровье',stamina:'Энергия',maxStamina:'Максимальная энергия'};
const digest=b=>createHash('sha256').update(b).digest('hex');
function parse(buffer,info=false){
 if(!Buffer.isBuffer(buffer)||!buffer.length||buffer.length>MAX)throw Error('Неверный размер XML');
 const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(buffer);
 if(/<!DOCTYPE|<!ENTITY/i.test(text))throw Error('DTD не поддерживается');
 const token=/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?xml(?:\s[^?]*)?\?>|<\/[A-Za-z_][\w:.-]*\s*>|<[A-Za-z_][\w:.-]*(?:\s+(?:[A-Za-z_][\w:.-]*\s*=\s*(?:"[^"<]*"|'[^'<]*')))*\s*\/?>|[^<]+/gy;
 let pos=0,root=null,closed=false;const stack=[],fields=new Map();const parent=info?['Farmer']:['SaveGame','player'];
 function isParent(){return stack.length===parent.length&&stack.every((x,i)=>x.name===parent[i])}
 while(pos<text.length){token.lastIndex=pos;const m=token.exec(text);if(!m)throw Error('Некорректный или неподдерживаемый XML');const raw=m[0],start=pos;pos=token.lastIndex;
  if(raw.startsWith('<?')){if(root||!/^﻿?\s*$/.test(text.slice(0,start)))throw Error('Неверная XML декларация');continue}
  if(raw.startsWith('<!--')||raw.startsWith('<![CDATA[')){if(stack.at(-1)?.field)throw Error('Сложное числовое поле');continue}
  if(raw.startsWith('</')){const name=raw.slice(2,-1).trim(),node=stack.pop();if(!node||node.name!==name)throw Error('Нарушена структура XML');if(node.field){const value=text.slice(node.at,start);if(!/^\s*\d+(?:\.\d+)?\s*$/.test(value)||!Number.isFinite(Number(value))||fields.has(name))throw Error('Неоднозначное поле '+name);const n=Number(value);if(name!=='stamina'&&!Number.isInteger(n))throw Error('Ожидается целое число');fields.set(name,{start:node.at,end:start,value:n})}if(!stack.length)closed=true;continue}
  if(raw.startsWith('<')){const name=raw.match(/^<([A-Za-z_][\w:.-]*)/)[1];if(stack.at(-1)?.field||closed)throw Error('Неверная вложенность');if(!root){root=name;if(root!==parent[0])throw Error('Это не сохранение Stardew Valley')}const field=isParent()&&Object.hasOwn(labels,name);if(raw.endsWith('/>')){if(field||!stack.length)throw Error('Пустое поле');continue}stack.push({name,field,at:pos});if(stack.length>256)throw Error('Слишком глубокий XML');continue}
  if(!stack.length&&!/^﻿?\s*$/.test(raw))throw Error('Текст за корнем XML');
 }
 if(stack.length||!closed||!root||(!info&&!fields.has('money')))throw Error('Не найден игрок Stardew Valley');
 return {text,fields}
}
function inspect(b){return [...parse(b).fields].map(([key,x])=>({key,label:labels[key],value:x.value,integer:key!=='stamina'}))}
function patch(buffer,changes,info=false){const {text,fields}=parse(buffer,info);let out=text;const patches=[];
 for(const [key,n]of Object.entries(changes)){const x=fields.get(key);if(!x){if(info)continue;throw Error('Поле недоступно: '+key)}patches.push({...x,key,n})}
 for(const x of patches.sort((a,b)=>b.start-a.start))out=out.slice(0,x.start)+String(x.n)+out.slice(x.end);
 const result=Buffer.from(out,'utf8'),after=parse(result,info).fields;for(const x of patches)if(after.get(x.key)?.value!==x.n)throw Error('Не удалось проверить XML');return result}
function validateChanges(b,changes){if(!changes||typeof changes!=='object'||Array.isArray(changes)||Object.keys(changes).length<1||Object.keys(changes).length>5)throw Error('Выберите значения');const original=parse(b).fields;
 for(const [key,n]of Object.entries(changes)){if(!original.has(key)||typeof n!=='number'||!Number.isFinite(n)||n<0||n>(key==='money'?999999999:10000)||key!=='stamina'&&!Number.isInteger(n)||key.startsWith('max')&&n<1)throw Error('Недопустимое значение: '+key)}
 for(const [cur,max]of [['health','maxHealth'],['stamina','maxStamina']]){const a=changes[cur]??original.get(cur)?.value,b=changes[max]??original.get(max)?.value;if(a!==undefined&&b!==undefined&&a>b)throw Error('Текущее значение превышает максимум: '+cur)}
}
async function ordinary(file,max=MAX){const s=await fs.lstat(file);if(!s.isFile()||s.isSymbolicLink()||s.size<1||s.size>max)throw Error('Недопустимый файл');const b=await fs.readFile(file);if(b.length!==s.size)throw Error('Файл изменился');return b}
async function openSave(file){const slot=path.basename(path.dirname(file));if(path.basename(file)!==slot||!/^[^\\/:*?"<>|\x00-\x1f]{1,130}_\d{1,20}$/.test(slot))throw Error('Выберите основной XML-файл в папке слота Stardew Valley');const folder=await fs.lstat(path.dirname(file));if(!folder.isDirectory()||folder.isSymbolicLink())throw Error('Неверная папка');const data=await ordinary(file),info=await ordinary(path.join(path.dirname(file),'SaveGameInfo'),8*1024*1024);parse(info,true);return {file,slot,hash:digest(data),infoHash:digest(info),hasInfo:true,fields:inspect(data)}}
async function exportSave(opened,changes,dest){const current=await openSave(opened.file);if(current.hash!==opened.hash||current.infoHash!==opened.infoHash)throw Error('Сохранение изменилось. Откройте заново.');const b=await ordinary(opened.file),info=await ordinary(path.join(path.dirname(opened.file),'SaveGameInfo'),8*1024*1024);if(digest(b)!==opened.hash||digest(info)!==opened.infoHash)throw Error('Файл изменился');validateChanges(b,changes);const out=patch(b,changes),metadata=patch(info,changes,true);const parent=await fs.mkdtemp(path.join(dest,'Nexora-Stardew-'));try{const folder=path.join(parent,current.slot);await fs.mkdir(folder);const file=path.join(folder,current.slot);await fs.writeFile(file,out,{flag:'wx'});await fs.writeFile(path.join(folder,'SaveGameInfo'),metadata,{flag:'wx'});const check=await openSave(file);if(check.hash!==digest(out)||check.infoHash!==digest(metadata))throw Error('Проверка копии не пройдена');return {folder,file,fields:check.fields}}catch(e){await fs.rm(parent,{recursive:true,force:true});throw e}}
module.exports={inspect,openSave,exportSave,patch,validateChanges};
