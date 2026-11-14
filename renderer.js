const $=s=>document.querySelector(s);
const content=$('#content');let data={games:[],favorites:[],history:[],backups:[]},page='home',selected='steam:4358690',query='',timer;
const plans={
 'steam:4358690':['Бессмертие','Бесконечная энергия','Бесконечные ресурсы','Мгновенное создание предметов','Неограниченные деньги','Скорость игры'],
 'steam:1091500':['Бессмертие','Бесконечные патроны','Неограниченные деньги','Опыт персонажа'],
 'steam:1086940':['Здоровье персонажей','Очки действий','Золото','Опыт персонажей']
};
function el(tag,cls,txt){const x=document.createElement(tag);if(cls)x.className=cls;if(txt!==undefined)x.textContent=txt;return x}
function button(text,cls,onClick,disabled=false){const x=el('button',cls,text);x.disabled=disabled;x.addEventListener('click',onClick);return x}
function toast(message){const t=$('#toast');t.textContent=message;t.hidden=false;clearTimeout(timer);timer=setTimeout(()=>t.hidden=true,4200)}
async function action(fn,msg){try{const result=await fn();if(result&&result.games)data=result;render();if(msg)toast(msg)}catch(e){toast(e.message||String(e))}}
function heading(k,title,sub){const box=el('section');box.append(el('div','eyebrow',k),el('h1','',title),el('p','',sub));content.append(box)}
function section(title,desc){const h=el('div','sectionhead');h.append(el('h2','',title),el('p','',desc));content.append(h)}
function card(g){const wrap=el('article','game'+(selected===g.id?' selected':''));const cover=button('','cover',()=>{selected=g.id;render()});cover.setAttribute('aria-label','Выбрать '+g.name);cover.style.setProperty('--cover',g.color||'#43415f');cover.append(el('span','fallback',g.name));if(/^steam:\d+$/.test(g.id)){const img=el('img');img.alt='';img.src='https://cdn.cloudflare.steamstatic.com/steam/apps/'+g.id.slice(6)+'/library_600x900.jpg';img.addEventListener('error',()=>img.remove(),{once:true});cover.append(img)}
 cover.append(el('span','status'+(g.installed?' installed':''),g.installed?'● Установлена':'Каталог'));wrap.append(cover);const fav=data.favorites.includes(g.id);const star=button(fav?'★':'☆','star'+(fav?' on':''),()=>action(()=>window.nexora.favorite(g.id)));star.setAttribute('aria-label',fav?'Убрать из избранного':'В избранное');star.setAttribute('aria-pressed',String(fav));wrap.append(star);const info=el('div','gameinfo');info.append(el('strong','',g.name),el('small','',g.genre||(g.kind==='local'?'Локальная игра':'Steam')));wrap.append(info);return wrap}
function detail(g){const box=el('section','detail');const top=el('div','detailhead');const labels=el('div');labels.append(el('div','eyebrow','ИГРОВОЙ ПРОФИЛЬ'),el('h2','',g.name),el('p','',g.installed?'Игра обнаружена · трейнер не подключён':'Игра из каталога · не установлена'));const actions=el('div','actions');actions.append(button('Резервная копия','secondary',()=>action(()=>window.nexora.backup(g.id))),button('▶ Запустить','primary',()=>action(()=>window.nexora.launch(g.id),'Команда запуска отправлена'),!g.installed));top.append(labels,actions);const body=el('div','detailbody');body.append(el('div','notice','Предпросмотр функций: трейнер ещё не подключён. Изменения игры недоступны.'));
 const mods=plans[g.id]||['Здоровье','Ресурсы','Скорость игры'];mods.forEach((name,i)=>{const row=el('div','mod'),right=el('div','modright');row.append(el('span','',name));const key=el('kbd','','F'+(i+1));const sw=button('','switch',()=>{},true);sw.setAttribute('aria-label',name+' — недоступно');right.append(key,sw);row.append(right);body.append(row)});box.append(top,body);content.append(box)}
function render(){content.replaceChildren();document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('active',b.dataset.page===page));
 if(page==='saves'){heading('SAVE VAULT','Сохранения','Локальные резервные копии игровых данных.');const g=data.games.find(x=>x.id===selected);if(g){const tools=el('div','sectionhead');tools.append(el('p','',g.name),button('＋ Создать копию','primary',()=>action(()=>window.nexora.backup(g.id))));content.append(tools)}if(!data.backups.length)content.append(el('div','empty','Пока нет сохранённых копий.'));for(const b of data.backups){const r=el('div','listitem'),l=el('div');l.append(el('strong','',b.game),el('small','',new Date(b.date).toLocaleString('ru-RU')));r.append(l,button('Открыть папку','secondary',()=>action(()=>window.nexora.openBackup(b.id))));content.append(r)}return}
 if(page==='settings'){heading('PREFERENCES','Настройки','Nexora работает локально, не требует аккаунта.');for(const [a,b] of [['Версия','0.1.0 · Alpha'],['Интерфейс','Русский · Midnight Violet'],['Данные','Библиотека и резервные копии хранятся в папке данных приложения.'],['Трейнеры','Движок не подключён. Управление памятью, оверлей и импорт таблиц запланированы.']]){const item=el('section','setting');item.append(el('h2','',a),el('p','',b));content.append(item)}return}
 let games=data.games.filter(g=>(page!=='library'||g.installed)&&(page!=='favorites'||data.favorites.includes(g.id))&&g.name.toLowerCase().includes(query.toLowerCase()));
 const installed=data.games.filter(g=>g.installed).length;
 heading(page==='home'?'YOUR GAME. YOUR RULES.':'YOUR COLLECTION',page==='home'?'Играй по своим правилам.':page==='library'?'Мои игры':'Избранное',page==='home'?'Твоя библиотека, игровой профиль и инструменты — в одном месте.':page==='library'?'Установленные игры Steam и добавленные вручную EXE.':'Игры, которые всегда под рукой.');
 section(query?'Результаты поиска':page==='home'?'Библиотека игр':page==='library'?'Установлено':'Коллекция',page==='home'?installed+' установлено':games.length+' игр');
 if(!games.length){content.append(el('div','empty','Игры не найдены. Попробуйте сканирование или добавьте EXE.'));return}
 if(!games.some(g=>g.id===selected))selected=games[0].id;
 const grid=el('div','games');const visible=page==='home'&&!query?games.slice(0,3):games; if(!visible.some(g=>g.id===selected))selected=visible[0].id;visible.forEach(g=>grid.append(card(g)));content.append(grid);detail(games.find(g=>g.id===selected));
 if(page==='home'&&!query&&games.length>3){section('Ещё игры','Каталог');const more=el('div','games');games.slice(3).forEach(g=>{const c=card(g);c.querySelector('.cover').addEventListener('click',()=>{page='library';if(!g.installed) {page='home';query=g.name;$('#search').value=query;}selected=g.id;render()});more.append(c)});content.append(more)}
}
document.querySelectorAll('nav button').forEach(b=>b.addEventListener('click',()=>{page=b.dataset.page;query='';$('#search').value='';render()}));
$('#search').addEventListener('input',e=>{query=e.target.value;if(page==='settings'||page==='saves')page='home';render()});
$('#refresh').addEventListener('click',()=>action(()=>window.nexora.list(),'Библиотека обновлена'));
$('#add').addEventListener('click',()=>action(()=>window.nexora.add()));
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();$('#search').focus()}});
action(()=>window.nexora.list());
