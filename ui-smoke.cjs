const fs=require('node:fs'),path=require('node:path');
function runSmoke(win,app,profile){
 const errors=[];win.webContents.on('console-message',(_event,level,message)=>{const msg=typeof level==='object'?level.message:message;const severity=typeof level==='object'?level.level:level;if(typeof msg==='string'&&(severity===3||severity==='error')&&!/Failed to load resource|net::ERR_|Not allowed to load local resource/i.test(msg))errors.push(msg.slice(0,500))});
 const deadline=setTimeout(()=>finish({ok:false,error:'UI smoke timeout'}),60000);
 let finished=false;
 function finish(report){if(finished)return;finished=true;clearTimeout(deadline);try{fs.writeFileSync(path.join(profile,'ui-smoke.json'),JSON.stringify(report,null,2))}finally{app.exit(report.ok?0:1)}}
 win.webContents.once('render-process-gone',(_e,detail)=>finish({ok:false,error:'Renderer exited: '+detail.reason}));
 win.webContents.once('did-fail-load',(_e,code,description,_url,isMainFrame)=>{if(isMainFrame)finish({ok:false,error:code+' '+description})});
 win.webContents.once('did-finish-load',async()=>{try{
  const result=await win.webContents.executeJavaScript("(async()=>{const errors=[];window.addEventListener('error',e=>errors.push(String(e.message)));window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));const expected=['home','library','favorites','trainers','translation','guides','profiles','mods','manager','downloads','saves','optimizer','performance','settings'];const result=[];const pause=ms=>new Promise(r=>setTimeout(r,ms));await pause(900);const library=await window.nexora.list(false);if(!Array.isArray(library.games))throw Error('Library IPC failed');for(const page of expected){const button=document.querySelector('nav [data-page='+page+']');if(!button)throw Error('Missing navigation '+page);button.click();await pause(350);const root=document.querySelector('#content');if(!button.classList.contains('active')||!root?.children.length)throw Error('Page failed: '+page);result.push({page,children:root.children.length,heading:root.querySelector('h1,h2')?.textContent||''})}return {pages:result,errors,version:document.querySelector('footer')?.textContent}})()",true);
  if(result.errors.length||errors.length)throw Error([...result.errors,...errors].join('; '));finish({ok:true,...result})
 }catch(e){finish({ok:false,error:String(e.message||e),errors})}});
}
module.exports={runSmoke};
