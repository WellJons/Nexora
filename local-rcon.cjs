const net=require('node:net'),{randomInt}=require('node:crypto');
function settings(v){if(!v||!Number.isInteger(v.port)||v.port<1024||v.port>65535||typeof v.password!=='string'||v.password.length<1||v.password.length>128||/[\x00-\x1f]/.test(v.password)||typeof v.player!=='string'||!/^[A-Za-z0-9_]{1,16}$/.test(v.player))throw Error('Укажите порт, пароль RCON и имя игрока');return {port:v.port,password:v.password,player:v.player}}
function packet(id,type,body){const b=Buffer.from(body,'utf8');if(b.length>1024)throw Error('Команда слишком длинная');const out=Buffer.alloc(b.length+14);out.writeInt32LE(b.length+10,0);out.writeInt32LE(id,4);out.writeInt32LE(type,8);b.copy(out,12);return out}
function exchange(config,command,connect=net.createConnection){
 const v=settings(config);if(typeof command!=='string'||command.length>300||/[\r\n\x00]/.test(command))return Promise.reject(Error('Invalid command'));
 return new Promise((resolve,reject)=>{let socket,done=false,buf=Buffer.alloc(0),authed=false;const auth=randomInt(1,1000000000),cmd=auth+1;
 const timer=setTimeout(()=>finish(Error('Локальный RCON не ответил')),5000);
 function finish(err,result){if(done)return;done=true;clearTimeout(timer);socket?.destroy();err?reject(err):resolve(result)}
 try{socket=connect({host:'127.0.0.1',port:v.port});socket.on('connect',()=>socket.write(packet(auth,3,v.password)));socket.on('error',()=>finish(Error('Не удалось подключиться к локальному RCON')));socket.on('close',()=>finish(Error('RCON закрыл соединение')));
 socket.on('data',chunk=>{try{if(buf.length+chunk.length>65536)throw Error('Ответ RCON слишком большой');buf=Buffer.concat([buf,chunk]);while(buf.length>=4){const n=buf.readInt32LE(0);if(n<10||n>16384)throw Error('Неверный пакет RCON');if(buf.length<n+4)break;const p=buf.subarray(0,n+4);buf=buf.subarray(n+4);const id=p.readInt32LE(4),type=p.readInt32LE(8);if(p[n+2]!==0||p[n+3]!==0)throw Error('Неверный пакет RCON');if(!authed){if(id===-1)throw Error('Неверный пароль RCON');if(id===auth&&type===2){authed=true;socket.write(packet(cmd,2,command))}}else if(id===cmd&&type===0){finish(null,p.subarray(12,n+2).toString('utf8').slice(0,2000));return}}}catch(e){finish(e)}})
 }catch(e){finish(e)}
 })
}
function actionCommand(player,id,on){if(!/^[A-Za-z0-9_]{1,16}$/.test(player))throw Error('Неверный игрок');if(id==='heal')return 'effect give '+player+' minecraft:instant_health 1 10 true';if(!['resist','vision'].includes(id)||typeof on!=='boolean')throw Error('Неизвестное действие');const effect=id==='resist'?'resistance':'night_vision';return on?'effect give '+player+' minecraft:'+effect+' 300 '+(id==='resist'?4:0)+' true':'effect clear '+player+' minecraft:'+effect}
module.exports={settings,packet,exchange,actionCommand};
