// Bundled implementation inventory; remote profiles cannot register executable adapters.
const entries=Object.freeze({
 'gk2-save':Object.freeze({mode:'live',live:'gk2',save:'gk2',name:'Автоматический трейнер Mono',features:['resources','freeze','inventory','save-copy'],status:'experimental'}),
 'stardew-save':Object.freeze({mode:'save',save:'stardew',name:'Редактор сохранений',features:['resources','save-copy'],status:'experimental'}),
 'bethesda-skyrim':Object.freeze({mode:'console',name:'Игровая консоль',features:['commands','items'],status:'manual-confirmation'}),
 'bethesda-fallout4':Object.freeze({mode:'console',name:'Игровая консоль',features:['commands','items'],status:'manual-confirmation'}),
 'minecraft':Object.freeze({mode:'rcon',live:'rcon',name:'Локальный сервер RCON',features:['commands','items','effects'],status:'requires-setup'}),
 'manual':Object.freeze({mode:'manual',name:'Ручной редактор',features:[],status:'manual'})
});
const expected={'graveyard-keeper-2':'gk2-save','stardew-valley':'stardew-save','skyrim':'bethesda-skyrim','fallout4':'bethesda-fallout4','minecraft':'minecraft'};
function capability(profile){if(!profile||!Object.hasOwn(entries,profile.engine))return {mode:'none',name:'Нет встроенного адаптера',features:[],status:'unavailable'};if(expected[profile.id]!==profile.engine)return {mode:'none',name:'Адаптер не привязан к данной игре',features:[],status:'unavailable'};return {...entries[profile.engine],features:[...entries[profile.engine].features]}}
function autoAdapter(profile,{rconConfigured=false}={}){const c=capability(profile);return c.live==='gk2'?'gk2':c.live==='rcon'&&rconConfigured?'rcon':null}
function describe(profile,game,auto,source){const c=capability(profile);return {profile:profile?.id||null,adapter:c.mode,features:c.features,status:c.status,installed:game?.installed===true,buildId:/^\d{1,20}$/.test(game?.buildId||'')?game.buildId:null,phase:auto?.gameId===game?.id?auto.phase:'idle',sourceStatus:['ready','found','missing','offline','unavailable'].includes(source?.status)?source.status:null,gameRuntimeVerified:false}}
module.exports={capability,autoAdapter,describe};
