// Built-in game commands; not memory presets. No automatic input or execution.
const catalog=[
 {id:'skyrim',name:'The Elder Scrolls V: Skyrim / Special Edition',hint:'Открой консоль клавишей ~ (раскладка EN). Введи команду и нажми Enter. Повтор переключателя отключает эффект.',items:[
 ['gold','Добавить 10 000 золота','player.additem 0000000f 10000'],['god','Режим бога (переключатель)','tgm'],['noclip','Отключение коллизий (переключатель)','tcl']]},
 {id:'fallout4',name:'Fallout 4',hint:'Открой консоль ~ (EN). В Survival консоль может быть недоступна. Повтор переключателя отключает эффект.',items:[
 ['caps','Добавить 10 000 крышек','player.additem 0000000f 10000'],['god','Режим бога (переключатель)','tgm'],['heal','Восстановить здоровье','player.resethealth'],['noclip','Отключение коллизий (переключатель)','tcl']]},
 {id:'minecraft',name:'Minecraft Java Edition (1.19.4+)',hint:'В собственном одиночном мире разреши команды и открой чат. Вставь команду и нажми Enter.',items:[
 ['heal','Восстановить здоровье','/effect give @s minecraft:instant_health 1 10 true'],['resist','Сопротивление урону на 5 минут','/effect give @s minecraft:resistance 300 4 true'],['resistoff','Снять сопротивление','/effect clear @s minecraft:resistance'],['diamonds','64 алмаза','/give @s minecraft:diamond 64'],['creative','Творческий режим','/gamemode creative'],['survival','Выживание','/gamemode survival']]}
];
function commandCatalog(){return catalog.map(g=>({...g,items:g.items.map(([id,name,command])=>({id,name,command}))}))}
function lookupCommand(game,id){const val=catalog.find(g=>g.id===game)?.items.find(x=>x[0]===id);if(!val)throw Error('Команда не найдена');return val[2]}
module.exports={commandCatalog,lookupCommand};
