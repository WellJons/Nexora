const profiles=require('./game-profiles.cjs');
function commandCatalog(){return profiles.metadata()}
function lookupCommand(game,id){const c=profiles.find(game)?.commands.find(x=>x.id===id);if(!c)throw Error('Команда не найдена');return c.command}
module.exports={commandCatalog,lookupCommand};
