// Read-only process discovery for explicit game launches. No injection, writes or auto-attachment.
function createLaunchSession({findGame,scopeOf,launch,list,send=()=>{},clock=Date.now,schedule=setTimeout,unschedule=clearTimeout,interval=2500,timeout=90000}){
 let session=null,timer=null,closed=false;
 let state={phase:'idle',gameId:null,name:'',processes:[],message:'',elapsed:0};
 function emit(patch){state={...state,...patch};send(snapshot());return snapshot()}
 function snapshot(){return {...state,processes:state.processes.map(p=>({...p}))}}
 function clear(){if(timer!==null)unschedule(timer);timer=null}
 function stop(message='Ожидание отменено'){clear();session=null;return emit({phase:'idle',gameId:null,name:'',processes:[],message,elapsed:0})}
 function valid(rows){if(!Array.isArray(rows))throw Error('Некорректный ответ движка');return rows.filter(p=>Number.isSafeInteger(p.pid)&&p.pid>4&&typeof p.name==='string').slice(0,64).map(p=>({pid:p.pid,name:p.name.slice(0,150)}))}
 function found(s,rows){if(session!==s)return;clear();emit({phase:'ready',processes:rows,elapsed:clock()-s.start,message:rows.length===1?'Процесс найден. Инструменты готовы к подключению.':'Найдено несколько процессов. Выберите нужный в трейнере.'});}
 function next(s){if(session!==s||closed)return;clear();timer=schedule(()=>{timer=null;void poll(s)},interval)}
 async function poll(s){if(session!==s||closed)return;
  try{
   if(clock()-s.start>=timeout){clear();session=null;emit({phase:'timeout',elapsed:clock()-s.start,message:'Игра ещё не обнаружена. Проверьте запуск в лаунчере или найдите процесс вручную.'});return}
   const rows=valid(await list(s.scope));if(session!==s||closed)return;
   if(rows.length){found(s,rows);return}
   emit({phase:'waiting',elapsed:clock()-s.start,message:'Ожидание процесса игры…'});next(s)
  }catch(e){if(session!==s||closed)return;session=null;clear();emit({phase:'error',message:String(e.message||e).slice(0,300),processes:[]})}
 }
 async function start(id,shouldLaunch=true){
  if(closed)throw Error('Приложение закрывается');
  if(session&&(state.phase==='checking'||state.phase==='launching'||state.phase==='waiting'))throw Error('Сначала завершите ожидание текущей игры');
  if(typeof shouldLaunch!=='boolean')throw Error('Неверный режим запуска');
  const g=findGame(id);if(!g)throw Error('Сначала установите или добавьте игру');
  const scope=scopeOf(g),s={scope,start:clock()};clear();session=s;
  emit({phase:'checking',gameId:g.id,name:g.name,processes:[],message:'Проверяем запущенные процессы…',elapsed:0});
  try{
   const rows=valid(await list(scope));if(session!==s||closed)return snapshot();
   if(rows.length){found(s,rows);return snapshot()}
   if(shouldLaunch){emit({phase:'launching',message:'Отправляем команду запуска…'});await launch(g.id);if(session!==s||closed)return snapshot()}
   emit({phase:'waiting',message:'Ожидание процесса игры…'});next(s);return snapshot()
  }catch(e){if(session===s&&!closed){session=null;clear();emit({phase:'error',message:String(e.message||e).slice(0,300),processes:[]})}return snapshot()}
 }
 return {start,state:snapshot,cancel:()=>stop(),close:()=>{closed=true;clear();session=null}};
}
module.exports={createLaunchSession};
