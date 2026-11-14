// UI animations are finite, compositor-friendly and never run continuously.
(() => {
 const motion=matchMedia('(prefers-reduced-motion: reduce)');
 let enabled=true,lastPage=null;
 try{enabled=localStorage.getItem('nexora-motion')!=='off'}catch{}
 function apply(){document.documentElement.classList.toggle('reduce-motion',!enabled||motion.matches)}
 apply();motion.addEventListener('change',apply);
 function setMotion(value){enabled=!!value;try{localStorage.setItem('nexora-motion',enabled?'on':'off')}catch{}apply()}
 function navigate(page,content){
  const button=document.querySelector('nav [data-page="'+page+'"]');
  document.getElementById('title-location').textContent=button?.getAttribute('aria-label')||'Nexora';
  document.querySelectorAll('nav button').forEach(b=>{if(b.dataset.page===page)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')});
  if(page===lastPage)return;lastPage=page;
  content.getAnimations().forEach(a=>a.cancel());
  if(enabled&&!motion.matches&&!document.hidden){content.animate([{opacity:.25,transform:'translateY(7px)'},{opacity:1,transform:'translateY(0)'}],{duration:220,easing:'cubic-bezier(.2,.7,.2,1)'})}
  window.scrollTo({top:0,behavior:'instant'});
 }
 window.nexoraDesign=Object.freeze({navigate,setMotion,motionEnabled:()=>enabled});
})();
