/* Page composition stays separate from evidence and catalog filtering. */
(()=>{
 'use strict';
 document.documentElement.dataset.inputMethod='pointer';
 document.addEventListener('keydown',()=>{document.documentElement.dataset.inputMethod='keyboard'},true);
 document.addEventListener('pointerdown',()=>{document.documentElement.dataset.inputMethod='pointer'},true);
 const home=window.CduData.home||{hero:[],picks:[],categories:{},counts:{}};
 const publishedAt=new Date(window.CduData.meta?.published_at||'');
 if(Number.isFinite(publishedAt.getTime())){
  const date=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(publishedAt).replaceAll('/','.');
  const version=document.getElementById('checked-date');if(version)version.textContent='数据库版本：'+date;
 }
 const featuredSeed=(home.hero||[]).concat(home.picks||[]).filter((e,i,a)=>e&&a.findIndex(x=>x&&x.id===e.id)===i);
 const byId=new Map(featuredSeed.map(e=>[e.id,e]));
 const make=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n};
 const guideCards=document.querySelector('.home-life-cards');
 if(guideCards){
  guideCards.replaceChildren();
  const guides=home.guides||[];
  guides.forEach((g,i)=>{const li=make('li'),a=make('a');a.href='#guide/'+encodeURIComponent(g.id);const copy=make('span');copy.append(make('strong',g.title),make('small',g.subtitle||g.summary||'阅读操作指南'));a.append(make('span',String(i+1).padStart(2,'0'),'hl-no'),copy,make('span','↗','hl-go'));li.append(a);guideCards.append(li);});
  const li=make('li'),a=make('a');a.href='#services';const copy=make('span');copy.append(make('strong','要打电话、找入口'),make('small','打开校园查询'));a.append(make('span',String(guides.length+1).padStart(2,'0'),'hl-no'),copy,make('span','↗','hl-go'));li.append(a);guideCards.append(li);
  const intro=document.querySelector('.home-life-copy>p:not(.home-life-kicker)');if(intro)intro.textContent='第一次遇到的校园问题，拆成能照着走的步骤；电话、地点和官方入口，放在需要时找得到的地方。';
 }
 const arrow=(cls='')=>{const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('aria-hidden','true');svg.setAttribute('class','arrow-icon '+cls);const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d','M5 19 19 5M5 5h14v14');svg.append(path);return svg};
 const queryLink=(entry)=>{const params=new URLSearchParams({q:entry.title});return '?'+params+'#all'};
 const featured=featuredSeed.filter(e=>!/^附件|\.(?:docx?|xlsx?|pdf|zip)$/i.test(e.title));
 const stage=document.getElementById('hero-activities');
 let currentBatch=['network','digital','marathon'].map(id=>byId.get(id)).filter(Boolean);
 function renderBatch(changed=false){stage.replaceChildren();currentBatch.forEach((e,i)=>{
   const a=make('a',undefined,'hero-ticket');a.href=queryLink(e);a.dataset.entryId=e.id;a.setAttribute('aria-label',e.category_label+'：'+e.title);const meta=make('div',undefined,'ticket-meta');meta.append(make('span',e.category_label),arrow('ticket-arrow'));a.append(meta,make('strong',e.title));stage.append(a);
   if(changed&&!reduced.matches&&!paused){const angle=getComputedStyle(a).getPropertyValue('--ticket-turn')||'0deg';animate(a,[{opacity:.4,transform:'translateY(14px) rotate(0deg)'},{opacity:1,transform:'translateY(0) rotate('+angle+')'}],i*35,320)}
 });if(changed)document.getElementById('swap-status').textContent='已换一批，显示 '+currentBatch.length+' 项精选活动。'}
 renderBatch();document.getElementById('swap-activities').addEventListener('click',()=>{currentBatch=CatalogCore.nextFeaturedBatch(featured,currentBatch.map(e=>e.id));renderBatch(true)});
 const categories={technology:'科技竞赛',creative:'文化创作',sports:'运动健身',volunteering:'志愿服务',practice:'社会实践',exchange:'国际交流'};
 for(const [id,label] of Object.entries(categories)){
   const count=(home.categories||{})[id]||0;
   const a=make('a',undefined,'category-door');a.href='?category='+id+'#all';const tail=make('span',undefined,'category-tail');tail.append(make('span',count+' 项'),arrow('category-arrow'));a.append(make('span',label),tail);document.getElementById('home-categories').append(a);
 }
 for(const e of featured.slice(0,4)){
   const v=e.versions.slice().sort((a,b)=>(b.published||'').localeCompare(a.published||''))[0];
   const a=make('a',undefined,'pick-row');a.href=queryLink(e);const published=make('span',v.published?v.published.replaceAll('-','.'):'查看活动','pick-date');if(v.published)published.setAttribute('aria-label','公告发布于 '+v.published);a.append(make('span',e.category_label,'pick-kind'),make('h3',e.title),published);document.getElementById('home-picks').append(a);
 }
 let page=null,heroPlayed=false;
 function show(view){
   const next=view==='guides'?'guides':view==='home'?'home':view==='about'?'about':view==='calendar'?'calendar':'query';
   document.getElementById('landing').hidden=next!=='home';document.getElementById('query-page').hidden=next!=='query';document.getElementById('about').hidden=next!=='about';document.getElementById('calendar-page').hidden=next!=='calendar';document.getElementById('guides-page').hidden=next!=='guides';document.body.dataset.page=next;document.dispatchEvent(new Event('cdu:view'));
   document.getElementById('query-heading-title').textContent='活动探索';
   document.querySelectorAll('.global-nav a').forEach(a=>{const active=a.dataset.page===next;if(active)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current')});
   document.title='成大早知道 · '+(next==='home'?'在大学里，多发现一种可能':next==='about'?'关于这个项目':next==='calendar'?'活动日历':next==='guides'?'校园指南':'活动探索');
   if(page!==null&&page!==next){window.scrollTo({top:0,behavior:'instant'});const surface=document.getElementById(next==='home'?'landing':next==='about'?'about':next==='calendar'?'calendar-page':next==='guides'?'guides-page':'query-page');if(!reduced.matches&&document.documentElement.dataset.inputMethod!=='keyboard'&&surface.animate)surface.animate([{opacity:0,transform:'translateY(16px)'},{opacity:1,transform:'translateY(0)'}],{duration:650,easing:'cubic-bezier(.22,1,.36,1)'})}page=next;if(next==='home')requestAnimationFrame(()=>{sizeMarquee();updateScrollMotion();playHero()});
 }
 const reduced=matchMedia('(prefers-reduced-motion:reduce)');let paused=reduced.matches;
 const toggle=document.getElementById('motion-toggle');
 function motion(){document.body.classList.toggle('home-paused',paused);toggle.disabled=reduced.matches;toggle.setAttribute('aria-pressed',String(paused));toggle.textContent=reduced.matches?'已减少动态效果':paused?'开启动效':'暂停动效';document.getElementById('landing').getAnimations({subtree:true}).filter(a=>a.id==='section-motion').forEach(a=>paused?a.pause():a.play())}
 toggle.addEventListener('click',()=>{paused=!paused;motion()});reduced.addEventListener('change',e=>{paused=e.matches;motion()});motion();
 document.addEventListener('visibilitychange',()=>document.body.classList.toggle('page-backgrounded',document.hidden));
 if('IntersectionObserver' in window){const observer=new IntersectionObserver(entries=>entries.forEach(e=>e.target.classList.toggle('motion-offscreen',!e.isIntersecting)));document.querySelectorAll('.orbit-art,.interest-track,.hero-activities,.home-end').forEach(n=>observer.observe(n))}
 const track=document.querySelector('.interest-track'),band=document.querySelector('.interest-band');
 const words='去比赛 · 去创作 · 去实践 · 去遇见 ·';let lastBandWidth=0;
 function sizeMarquee(){
   const width=band.clientWidth;if(!width||width===lastBandWidth)return;
   const unit=track.querySelector('.interest-unit');const unitWidth=unit.getBoundingClientRect().width;if(!unitWidth)return;
   const group=make('div',undefined,'interest-group');const count=Math.ceil((width+32)/unitWidth)+1;
   for(let i=0;i<count;i++)group.append(make('span',words,'interest-unit'));
   track.replaceChildren(group,group.cloneNode(true));track.style.setProperty('--marquee-duration',(group.getBoundingClientRect().width/45)+'s');lastBandWidth=width;
 }
 if('ResizeObserver' in window)new ResizeObserver(()=>requestAnimationFrame(sizeMarquee)).observe(band);else addEventListener('resize',()=>{lastBandWidth=0;sizeMarquee()});
 if(document.fonts)document.fonts.ready.then(()=>{lastBandWidth=0;sizeMarquee()});requestAnimationFrame(sizeMarquee);
 function animate(node,frames,delay=0,duration=500){if(!node?.animate)return;const a=node.animate(frames,{duration,delay,easing:'cubic-bezier(.16,1,.3,1)',fill:'backwards'});a.id='section-motion'}
 if('IntersectionObserver' in window){
   const lower=new IntersectionObserver(entries=>entries.forEach(e=>{
     if(!e.isIntersecting)return;lower.unobserve(e.target);if(reduced.matches||paused)return;
     const n=e.target;
     if(n.classList.contains('category-door')){const offset=[...n.parentElement.children].indexOf(n)%2?20:-20;animate(n,[{transform:'translateX('+offset+'px)',clipPath:'inset(0 18% 0 0)',opacity:.55},{transform:'translateX(0)',clipPath:'inset(0)',opacity:1}],Math.min([...n.parentElement.children].indexOf(n)*45,160))}
     else if(n.classList.contains('pick-row')){animate(n,[{clipPath:'inset(0 14% 0 0)',opacity:.55},{clipPath:'inset(0)',opacity:1}],0,420)}
     else if(n.classList.contains('history-preview')){const years=n.querySelectorAll('.history-years span');animate(years[0],[{transform:'translateX(-30px)',opacity:.4},{transform:'translateX(0)',opacity:1}]);animate(years[1],[{transform:'translateX(30px)',opacity:.4},{transform:'translateX(0)',opacity:1}],100);animate(n.querySelector('svg path'),[{strokeDashoffset:1},{strokeDashoffset:0}],120,750)}
     else animate(n.querySelector('.round-link'),[{transform:'rotate(-22deg) scale(.85)'},{transform:'rotate(0deg) scale(1)'}],0,650);
   }),{threshold:.18});
   document.querySelectorAll('.category-door,.pick-row,.history-preview,.home-end').forEach(n=>lower.observe(n));
 const accents=new IntersectionObserver(entries=>entries.forEach(e=>{e.target.classList.toggle('is-in-view',e.isIntersecting);if(e.isIntersecting&&!reduced.matches&&!paused&&e.target.classList.contains('home-section-heading'))animate(e.target.querySelector('h2'),[{opacity:.6,transform:'translateY(20px)'},{opacity:1,transform:'translateY(0)'}],0,600)}),{threshold:.35});document.querySelectorAll('.home-section-heading,.category-door,.history-preview').forEach(n=>accents.observe(n));
 }
 document.getElementById('about-count').textContent=String((home.counts||{}).cards||0);
 const guideCount=document.getElementById('about-guide-count');if(guideCount)guideCount.textContent=String((home.counts||{}).guides||0);
 const zones=[...document.querySelectorAll('.home-explore,.home-interlude,.home-picks,.home-history,.home-end')];let scrollQueued=false;
 const progress=make('div',undefined,'scroll-progress');progress.setAttribute('aria-hidden','true');progress.append(make('span'));document.body.append(progress);
 function updateScrollMotion(){
  scrollQueued=false;if(page!=='home'||reduced.matches||paused||document.hidden)return;
  const max=document.documentElement.scrollHeight-innerHeight;
  const measures=zones.map(zone=>({zone,rect:zone.getBoundingClientRect()}));
  progress.firstElementChild.style.transform='scaleX('+(max>0?Math.min(1,Math.max(0,scrollY/max)):0)+')';
  for(const {zone,rect} of measures){if(rect.bottom<0||rect.top>innerHeight)continue;const p=Math.max(0,Math.min(1,(innerHeight-rect.top)/(innerHeight+rect.height)));
   const heading=zone.querySelector('.home-section-heading h2,.home-end h2');if(heading)heading.style.translate='0 '+(-20*p)+'px';
   if(zone.classList.contains('home-history')){const years=zone.querySelectorAll('.history-years span');years[0].style.translate=((1-p)*-20)+'px 0';years[1].style.translate=((1-p)*20)+'px 0'}
   if(zone.classList.contains('home-interlude')){zone.querySelector('.interlude-star').style.transform='rotate('+(p*160-60)+'deg)';zone.querySelector('strong').style.transform='translateX('+((1-p)*46)+'px) rotate('+((1-p)*-3)+'deg)';zone.querySelector('.interlude-rule').style.transform='scaleX('+(.2+p*.8)+')'}
  }
 }
 function playHero(){if(heroPlayed||reduced.matches||paused)return;heroPlayed=true;document.querySelectorAll('.hero-line').forEach((line,i)=>animate(line,[{opacity:.45,transform:'translateY(24px)'},{opacity:1,transform:'translateY(0)'}],i*90,700));document.querySelectorAll('.hero-ticket').forEach((ticket,i)=>animate(ticket,[{opacity:.55,transform:'translateY(28px) rotate(0deg)'},{opacity:1,transform:'translateY(0) rotate('+getComputedStyle(ticket).getPropertyValue('--ticket-turn')+')'}],120+i*80,750))}
 const scene=document.querySelector('.activity-stage');let sceneRect=null,pointerFrame=0,pointerX=0,pointerY=0;
 const finePointer=matchMedia('(hover:hover) and (pointer:fine)');
 scene.addEventListener('pointerenter',()=>{sceneRect=scene.getBoundingClientRect()});
 scene.addEventListener('pointermove',event=>{if(!finePointer.matches||reduced.matches||paused||!sceneRect)return;pointerX=(event.clientX-sceneRect.left)/sceneRect.width-.5;pointerY=(event.clientY-sceneRect.top)/sceneRect.height-.5;if(!pointerFrame)pointerFrame=requestAnimationFrame(()=>{pointerFrame=0;scene.style.transform='rotateX('+(-pointerY*5)+'deg) rotateY('+(pointerX*6)+'deg)'})});
 function resetScene(){if(pointerFrame)cancelAnimationFrame(pointerFrame);pointerFrame=0;scene.style.transform=''}
 scene.addEventListener('pointerleave',resetScene);toggle.addEventListener('click',resetScene);reduced.addEventListener('change',resetScene);

 function queueScroll(){if(!scrollQueued){scrollQueued=true;requestAnimationFrame(updateScrollMotion)}}
 addEventListener('scroll',queueScroll,{passive:true});addEventListener('resize',queueScroll);toggle.addEventListener('click',queueScroll);
 document.querySelectorAll('[data-copy]').forEach(button=>button.addEventListener('click',async()=>{
 const text=button.dataset.copy,status=document.getElementById('copy-status');let copied=false;
 try{await navigator.clipboard.writeText(text);copied=true}catch{
 const input=document.createElement('textarea');input.value=text;input.setAttribute('aria-label','待复制内容');input.style.cssText='position:fixed;top:0;left:0;opacity:0';document.body.append(input);input.select();try{copied=document.execCommand('copy')}catch{}input.remove();button.focus();
 }
 status.textContent=copied?'已复制'+button.dataset.copyLabel+'：'+text+(button.dataset.copyLabel==='公众号名称'?'，可在微信搜索。':''):'未能自动复制，请手动复制：'+text;
 }));
 window.SitePages={show};
})();
