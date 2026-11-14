const get=id=>document.getElementById(id);
let answered=false;
async function answer(value){if(answered)return;answered=true;get('cancel').disabled=get('accept').disabled=true;try{await window.nexoraConfirm.answer(value)}catch{window.close()}}
get('cancel').addEventListener('click',()=>answer(0));get('accept').addEventListener('click',()=>answer(1));
document.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();answer(0)}});
window.nexoraConfirm.state().then(s=>{get('title').textContent=s.title;get('message').textContent=s.message;get('detail').textContent=s.detail;get('cancel').textContent=s.buttons[0];get('accept').textContent=s.buttons[1];document.body.classList.toggle('warning',s.warning);get('cancel').disabled=get('accept').disabled=false;get('cancel').focus()}).catch(()=>window.close());
