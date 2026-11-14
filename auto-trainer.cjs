// Connect only bundled single-player adapters, after an explicit launch. No automatic writes.
function createAutoTrainer({resolve,connect,send=()=>{},schedule=setTimeout,unschedule=clearTimeout,clock=Date.now,interval=18000,timeout=240000,maxAttempts=5,resumeDelay=3000}){
 let token=null,timer=null,state={phase:'idle',gameId:null,attempt:0,message:''};
 const snapshot=()=>({...state});
 function emit(patch,live){state={...state,...patch};send(snapshot(),live);return snapshot()}
 function clear(){if(timer!==null)unschedule(timer);timer=null}
 function cancel(){clear();token=null;return emit({phase:'idle',gameId:null,attempt:0,message:''})}
 function arm(id){cancel();if(!id)return snapshot();token={id,start:null,attempt:0,running:false};return emit({phase:'waiting-process',gameId:id,attempt:0,message:'Ожидаем запуск игры…'})}
 function observe(launch){const t=token;if(!t||launch.gameId!==t.id)return;if(['error','timeout','idle'].includes(launch.phase)){cancel();return}if(launch.phase!=='ready'||t.start!==null)return;
  const adapter=resolve(t.id);if(!adapter){token=null;emit({phase:'manual',message:'Автоматического подключения для этой игры пока нет. Проверь готовые функции или каталог.'});return}
  t.adapter=adapter;t.start=clock();void attempt(t)
 }
 function resume(id,pid){if(state.phase!=='ready'||state.gameId!==id||!Number.isSafeInteger(pid)||pid<=4)return false;const adapter=resolve(id);if(!adapter)return false;clear();const t={id,adapter,expectedPid:pid,start:clock(),attempt:0,running:false};token=t;emit({phase:'waiting-save',attempt:0,message:'Сохранение сменилось. Ищем новый игровой мир; прежние фиксации отключены.'});timer=schedule(()=>{timer=null;void attempt(t)},resumeDelay);return true}
 async function attempt(t){if(token!==t||t.running)return;if(t.attempt>=maxAttempts||clock()-t.start>=timeout){token=null;emit({phase:'failed',message:'Сохранение не обнаружено. Загрузи его и нажми «Подключить автоматически».'});return}
  t.running=true;t.attempt++;emit({phase:'connecting',attempt:t.attempt,message:t.adapter==='external'?'Подготавливаем одобренный внешний трейнер…':t.adapter==='rcon'?'Проверяем локальный сервер…':'Поиск текущего сохранения и игровых ресурсов…'});
  try{const value=await connect(t.id,t.adapter,t.expectedPid);if(token!==t)return;if(value?.connected){token=null;emit({phase:'ready',message:value.adapter==='external'?'Внешний трейнер запущен. Проверь подключение в его окне.':'Трейнер подключён. Выбери нужные функции.'},value);return}throw Error(value?.warning||'Игровой мир ещё не готов')}
  catch(e){if(token!==t)return;if(e?.permanent||t.attempt>=maxAttempts||clock()-t.start>=timeout){token=null;emit({phase:'failed',message:String(e.message||e).slice(0,220)});return}emit({phase:'waiting-save',message:'Загрузи сохранение. Повторим поиск автоматически.'});timer=schedule(()=>{timer=null;void attempt(t)},interval)}
  finally{t.running=false}
 }
 return {arm,observe,resume,cancel,state:snapshot,pending:()=>!!token}
}
module.exports={createAutoTrainer};
