const fs=require('node:fs'),path=require('node:path');
const kinds=['cheat-engine','apprentice'];
function checkKind(kind){if(!kinds.includes(kind))throw Error('Неизвестный движок');return kind}
function checkFile(file,ext){if(typeof file!=='string'||!path.isAbsolute(file)||path.extname(file).toLowerCase()!==ext)throw Error('Неподходящий тип файла');const p=fs.realpathSync(file);if(path.extname(p).toLowerCase()!==ext||!fs.statSync(p).isFile())throw Error('Файл не найден');return p}
function launchSpec(engine,table){checkKind(engine.kind);const executable=checkFile(engine.path,'.exe');const args=[];if(table){if(engine.kind!=='cheat-engine')throw Error('Таблицы CT открываются только через Cheat Engine');args.push(checkFile(table.path,'.ct'))}return {executable,args,cwd:path.dirname(executable)}}
module.exports={checkKind,checkFile,launchSpec};
