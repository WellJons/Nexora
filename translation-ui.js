function draw(s){
 const full=s.mode==='window',panel=document.getElementById('panel'),labels=document.getElementById('labels');panel.hidden=full;labels.replaceChildren();
 if(full){for(const b of s.labels||[]){const x=document.createElement('div');x.className='translated-label';x.textContent=b.translation;x.style.left=Math.min(96,Math.max(0,b.x*100))+'%';x.style.top=Math.min(94,Math.max(0,b.y*100))+'%';x.style.width=Math.min(100-b.x*100,Math.max(5,b.w*100+1.5))+'%';x.style.fontSize=Math.max(12,Math.min(26,b.h*window.innerHeight/(Math.max(1,Math.ceil(b.translation.length/Math.max(12,b.text.length)))*1.2)))+'px';labels.append(x)}return}
 document.getElementById('hint').textContent=s.hotkey?s.hotkey+' · завершить':'Остановить можно в Nexora';document.getElementById('status').textContent=s.status;document.getElementById('caption').textContent=s.translation||'Ожидание игрового текста…'
}window.caption.onChange(draw);window.caption.state().then(draw).catch(()=>{});
