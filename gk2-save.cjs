// Odin wire grammar and field mapping adapted from NetroScript/gk2-save-core (MIT).
// See docs/licenses/NetroScript-GK2-MIT.txt and docs/GK2.md. No game assets or assemblies.
const fs=require('node:fs/promises'),path=require('node:path'),{createHash}=require('node:crypto');
const MAX=48*1024*1024,limit=700000;
const labels={hp:'Здоровье',max_hp:'Максимальное здоровье',money:'Деньги (внутреннее значение)',energy:'Энергия',stamina:'Выносливость',insanity:'Безумие',happiness:'Счастье',tech_red:'Красные очки технологий',tech_green:'Зелёные очки технологий',tech_blue:'Синие очки технологий'};
const digest=b=>createHash('sha256').update(b).digest('hex');
const fail=m=>{throw Error(m)};
function parse(buffer){
 if(!Buffer.isBuffer(buffer)||buffer.length>MAX||!buffer.length)fail('Недопустимый размер сохранения');
 let pos=0,records=0;const roots=[],stack=[],types=new Map(),objects=new Map(),refs=new Set();
 function take(n){if(!Number.isSafeInteger(n)||n<0||pos+n>buffer.length)fail('Повреждённое или неизвестное сохранение');const start=pos;pos+=n;return start}
 const u8=()=>buffer[take(1)],i32=()=>buffer.readInt32LE(take(4));
 function str(){const wide=u8(),count=i32();if(wide>1||count<0)fail('Неизвестная строка');const p=take(count*(wide?2:1));return buffer.toString(wide?'utf16le':'latin1',p,pos)}
 while(pos<buffer.length){
  if(++records>limit)fail('Слишком сложное сохранение');
  const tag=u8(),named=tag===1||tag===3||tag===50||tag>=9&&tag<=45&&tag%2===1,base=named&&tag>=9&&tag<=45?tag+1:tag,name=named?str():null;
  if(tag===5||tag===7){const obj=stack.pop();if(!obj||(tag===7)!==(obj.tag===6)||obj.tag===6&&obj.children.length!==obj.count)fail('Некорректная структура');continue}
  if(tag===49){if(stack.length||pos!==buffer.length)fail('Некорректный конец файла');break}
  const r={tag,base,name,children:[]};if(stack.length)stack.at(-1).children.push(r);else roots.push(r);
  if(tag>=1&&tag<=4){const type=u8();if(type===47){const id=i32();if(id<0||types.has(id))fail('Повтор типа');r.type=str();types.set(id,r.type)}else if(type===48){const id=i32();if(!types.has(id))fail('Неизвестный тип');r.type=types.get(id)}else if(type!==46)fail('Неизвестный тип');
   if(tag<=2){const id=i32();if(id<0||objects.has(id))fail('Повтор объекта');objects.set(id,r)}stack.push(r)
  }else if(tag===6){const n=buffer.readBigInt64LE(take(8));if(n<0n||n>BigInt(limit))fail('Некорректный массив');r.count=Number(n);stack.push(r)}
  else if(tag===8){const count=i32(),width=i32();if(count<0||![1,2,4,8,16].includes(width))fail('Некорректный массив');take(count*width)}
  else if([39,40,50,51].includes(tag))r.text=str();
  else if(tag!==45&&tag!==46){const width=({10:4,12:4,14:16,16:1,18:1,20:2,22:2,24:4,26:4,28:8,30:8,32:4,34:8,36:16,38:2,42:16,44:1})[base];if(!width)fail('Неизвестный тип записи: '+tag);r.offset=take(width);if(base===10){r.ref=buffer.readInt32LE(r.offset);refs.add(r.ref)}if(base===44&&buffer[r.offset]>1)fail('Некорректный bool')}
  if(stack.length>256)fail('Слишком глубокая структура');
 }
 if(stack.length||roots.length!==1||[...refs].some(x=>!objects.has(x)))fail('Неполное сохранение');
 const root=roots[0];if(!/(?:^|[.+])GameSave(?:,|$)/.test(root.type||''))fail('Не распознан корневой тип GameSave');
 function resolve(r){if(!r)fail('Поле отсутствует');return r.base===10?objects.get(r.ref):r}
 function field(r,name){const matches=resolve(r).children.filter(x=>x.name===name);if(matches.length!==1)fail('Поле отсутствует или неоднозначно: '+name);return resolve(matches[0])}
 function array(r){const list=resolve(r).children.filter(x=>x.tag===6);if(list.length!==1)fail('Неизвестный список');return list[0].children}
 const player=field(root,'playerData'),res=field(player,'res'),names=array(field(res,'resType')),values=array(field(res,'resValues'));if(names.length!==values.length)fail('Несовпадение списка ресурсов');
 const fields=new Map(),seen=new Set(),offsets=new Set();
 function add(key,r,base){if(r.base!==base||!Number.isInteger(r.offset)||offsets.has(r.offset))fail('Неизвестное или совпадающее поле ресурса');const value=base===24?buffer.readInt32LE(r.offset):buffer.readFloatLE(r.offset);if(!Number.isFinite(value))fail('Некорректное число');offsets.add(r.offset);fields.set(key,{offset:r.offset,base,value})}
 for(let i=0;i<names.length;i++){const n=resolve(names[i]).text,atom=resolve(values[i]);if(typeof n!=='string'||seen.has(n)||field(atom,'type').text!==n)fail('Несовпадение имён ресурсов');seen.add(n);if(Object.hasOwn(labels,n)&&!['hp','max_hp'].includes(n))add(n,field(atom,'value'),32)}
 const hp=field(player,'hpComponent');add('hp',field(hp,'hp'),24);add('max_hp',field(hp,'maxHpValue'),24);
 return fields
}
function inspect(buffer){const fields=parse(buffer);return [...fields].map(([key,r])=>({key,label:labels[key],value:r.value,integer:r.base===24||key.startsWith('tech_')}))}
function edit(buffer,changes){if(!changes||typeof changes!=='object'||Array.isArray(changes)||Object.keys(changes).length<1||Object.keys(changes).length>10)fail('Выберите значения');const fields=parse(buffer),out=Buffer.from(buffer);
 for(const [key,n]of Object.entries(changes)){const r=fields.get(key);if(!r||typeof n!=='number'||!Number.isFinite(n)||n<0||n>10000000||((r.base===24||key.startsWith('tech_'))&&!Number.isInteger(n))||key==='max_hp'&&n===0)fail('Недопустимое значение: '+key);if(r.base===24)out.writeInt32LE(n,r.offset);else out.writeFloatLE(n,r.offset)}
 const after=parse(out),hp=after.get('hp').value,max=after.get('max_hp').value;if(hp>max)fail('Здоровье не должно превышать максимум');
 for(const [key,n]of Object.entries(changes)){const r=after.get(key);if(r.value!==(r.base===32?Math.fround(n):n))fail('Проверка записи не пройдена')}return out
}
async function ordinary(file,max=MAX){const s=await fs.lstat(file);if(!s.isFile()||s.isSymbolicLink()||s.size>max||s.size<1)fail('Недопустимый файл');const data=await fs.readFile(file);if(data.length!==s.size||data.length>max)fail('Размер файла изменился');return data}
async function openSave(file){if(path.extname(file).toLowerCase()!=='.dat')fail('Выберите .dat');const data=await ordinary(file),infoPath=file.slice(0,-4)+'.info';let info=null;try{info=await ordinary(infoPath,1024*1024)}catch(e){if(e.code!=='ENOENT')throw e}return {file,hash:digest(data),infoHash:info?digest(info):null,hasInfo:!!info,fields:inspect(data)}}
async function exportSave(opened,changes,folder){const current=await openSave(opened.file);if(current.hash!==opened.hash||current.infoHash!==opened.infoHash)fail('Сохранение изменилось. Откройте его заново.');const data=await ordinary(opened.file);if(digest(data)!==opened.hash)fail('Сохранение изменилось');const result=edit(data,changes);let info=null;if(opened.hasInfo){info=await ordinary(opened.file.slice(0,-4)+'.info',1024*1024);if(digest(info)!==opened.infoHash)fail('Метаданные изменились')}
 const dest=await fs.mkdtemp(path.join(folder,'Nexora-GK2-'));try{const file=path.join(dest,path.basename(opened.file));await fs.writeFile(file,result,{flag:'wx'});if(info)await fs.writeFile(file.slice(0,-4)+'.info',info,{flag:'wx'});if(digest(await ordinary(file))!==digest(result))fail('Ошибка проверки копии');return {folder:dest,file,fields:inspect(result)}}catch(e){await fs.rm(dest,{recursive:true,force:true});throw e}}
module.exports={inspect,edit,openSave,exportSave};
