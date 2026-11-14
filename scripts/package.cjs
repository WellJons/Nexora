const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),stage=path.join(root,'dist','stage'),out=path.join(root,'dist');
fs.rmSync(stage,{recursive:true,force:true});fs.mkdirSync(stage,{recursive:true});
for(const name of ['package.json','main.cjs','preload.cjs','index.html','renderer.js','styles.css','core.cjs','mods.cjs','mod-plan.cjs','manager.cjs','performance.cjs','library.cjs','memory-bridge.cjs','overlay.cjs','overlay-preload.cjs','overlay.html','overlay.css','overlay.js','gog.cjs','native-bin','save-vault.cjs','README.md','docs'])fs.cpSync(path.join(root,name),path.join(stage,name),{recursive:true});
const runtime=path.join(stage,'node_modules','systeminformation');fs.mkdirSync(path.dirname(runtime),{recursive:true});fs.cpSync(path.join(root,'node_modules','systeminformation'),runtime,{recursive:true});
const source=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));delete source.devDependencies;delete source.scripts;fs.writeFileSync(path.join(stage,'package.json'),JSON.stringify(source,null,2));
const cli=path.join(path.dirname(path.dirname(require.resolve('@electron/packager'))),'bin','electron-packager.mjs');
const run=spawnSync(process.execPath,[cli,stage,'Nexora','--platform=win32','--arch=x64','--out='+out,'--overwrite','--no-prune','--no-asar','--electron-version=45.3.2'],{cwd:root,stdio:'inherit'});if(run.error)throw run.error;if(run.status!==0)process.exit(run.status||1);
const dest=path.join(out,'Nexora-win32-x64');for(const name of ['Nexora.exe','resources/app/main.cjs','resources/app/native-bin/Nexora.Memory.exe','resources/app/node_modules/systeminformation/package.json'])if(!fs.existsSync(path.join(dest,name)))throw Error('Bundle missing '+name);
