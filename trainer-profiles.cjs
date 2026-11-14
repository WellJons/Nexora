const {randomUUID}=require('node:crypto');
function normalize(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Некорректный шаблон');
 if(typeof value.name!=='string'||!value.name.trim()||value.name.trim().length>70)throw Error('Введите название до 70 символов');
 if(!['int32','float32'].includes(value.kind)||typeof value.target!=='number'||!Number.isFinite(value.target))throw Error('Неверный тип или число');
 if(value.kind==='int32'&&(!Number.isInteger(value.target)||value.target<-2147483648||value.target>2147483647))throw Error('Целое число вне диапазона Int32');
 if(value.kind==='float32'&&!Number.isFinite(Math.fround(value.target)))throw Error('Число вне диапазона Float32');
 if(typeof value.notes!=='string'||value.notes.length>500)throw Error('Комментарий не должен превышать 500 символов');
 return {name:value.name.trim(),kind:value.kind,target:value.target,notes:value.notes.trim()};
}
function saveRecipe(rows,gameId,value,now=new Date()){
 const next=normalize(value);if(typeof gameId!=='string'||!gameId||gameId.length>250)throw Error('Неизвестная игра');
 const same=rows.find(x=>x.gameId===gameId&&x.name.toLowerCase()===next.name.toLowerCase());
 if(!same&&rows.filter(x=>x.gameId===gameId).length>=40)throw Error('Лимит 40 шаблонов на игру');
 if(!same&&rows.length>=1000)throw Error('Лимит 1000 шаблонов');
 return [{id:same?.id||randomUUID(),gameId,...next,updated:now.toISOString()},...rows.filter(x=>x.id!==same?.id)];
}
module.exports={normalize,saveRecipe};
