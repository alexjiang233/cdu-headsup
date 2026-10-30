(()=>{
 'use strict';
 /* 指南与校园查询：数据来自 /api/v1/guides/ 与 /api/v1/services/，不再内嵌。 */
 const meta=window.CduData.meta||{};
 const make=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n};
 const external=(text,url,cls='life-link')=>{const a=make('a',text,cls);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a};
 const local=(text,url,cls='life-link')=>{const a=make('a',text,cls);a.href=url;return a};
 const reduced=matchMedia('(prefers-reduced-motion:reduce)');
 const icons={network:'M4 8a13 13 0 0 1 24 0M8 13a8 8 0 0 1 16 0M13 18a3 3 0 0 1 6 0M16 23h.01',running:'M18 4h.01M13 10l5-2 5 5 5 1M18 9l-4 9 5 3 1 7M14 18l-5 6H4',club:'M11 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM21 13a4 4 0 1 0 0-8M3 27v-4a8 8 0 0 1 16 0v4M23 17a7 7 0 0 1 6 6v4'};
 Object.assign(icons,{
  living:'M6 14 16 5l10 9M9 12v15h14V12M14 27v-9h5v9M12 14h.01M21 14h.01',
  account:'M10 14V9a6 6 0 0 1 12 0v5M7 14h18v14H7zM16 19v4',
  library:'M4 6h8l4 3 4-3h8v20h-8l-4 3-4-3H4zM16 9v20M8 12h4M8 17h4M20 12h4M20 17h4',
  study:'M4 9h24v18H4zM4 15h24M10 5v8M22 5v8M10 20h3M19 20h3M10 24h3',
  support:'M5 13 16 5l11 8-11 8zM9 16v7q7 6 14 0v-7M27 13v11',
 });
 const guideLooks={
  'campus-living':['living','clay'],'mobile-network':['network','blue'],
  'digital-account':['account','violet'],'running':['running','orange'],
  'library-basics':['library','teal'],'student-affairs':['study','indigo'],
  'student-support':['support','gold'],
 };
 function icon(type){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 32 32');svg.setAttribute('aria-hidden','true');const p=document.createElementNS(svg.namespaceURI,'path');p.setAttribute('d',icons[type]||icons.network);svg.append(p);return svg}
 let guideCategory='全部',serviceCategory='全部',lastGuide=null;
 let guideRows=[],serviceRows=[],guidesLoaded=false,servicesLoaded=false,articleRequest=0,routeRequest=0;
 function chips(id,values,selected,change){const host=document.getElementById(id);host.replaceChildren();for(const label of ['全部',...values]){const b=make('button',label);b.type='button';b.setAttribute('aria-pressed',String(label===selected));b.addEventListener('click',()=>change(label));host.append(b)}}
 const query=id=>document.getElementById(id).value.trim().toLowerCase();
 function empty(host,clear){const n=make('div',undefined,'life-empty');n.append(make('h2','换个关键词试试。'),make('p','也可以清除筛选，看看已有内容。'));const b=make('button','清除筛选','life-action');b.type='button';b.addEventListener('click',clear);n.append(b);host.append(n)}
 function failure(host,message,retry){const n=make('div',undefined,'life-empty');n.append(make('h2','内容没有加载成功。'),make('p',message||'网络或服务暂时不可用，这不等于没有内容。'));const b=make('button','重试','life-action');b.type='button';b.addEventListener('click',retry);n.append(b);host.append(n)}
 async function loadGuides(){
  if(guidesLoaded)return;
  const host=document.getElementById('guide-grid');
  try{const data=await window.CduApi.guides();guideRows=data.results||[];guidesLoaded=true}
  catch(error){failure(host,'指南数据没有取到：'+(error.message||'网络异常'),()=>{guidesLoaded=false;loadGuides().then(renderGuides)});throw error}
 }
 async function loadServices(){
  if(servicesLoaded)return;
  const host=document.getElementById('service-grid');
  try{const data=await window.CduApi.services();serviceRows=(data.results||[]).map(s=>({
    id:s.id,title:s.name,category:s.category,description:s.description,owner:s.owner,phone:s.phone,
    url:s.url,source:s.source_url,sourceLabel:s.source_label,sourceDate:s.source_date,
    checked:s.checked_on,note:s.note,guide:s.related_guide,location:s.location}));servicesLoaded=true}
  catch(error){failure(host,'校园查询没有取到：'+(error.message||'网络异常'),()=>{servicesLoaded=false;loadServices().then(renderServices)});throw error}
 }
 function renderGuides(){
  chips('guide-filters',[...new Set(guideRows.map(g=>g.category).filter(Boolean))],guideCategory,v=>{guideCategory=v;renderGuides()});
  const q=query('guide-search');const rows=guideRows.filter(g=>(guideCategory==='全部'||g.category===guideCategory)&&[g.title,g.subtitle,g.summary,...(g.tags||[])].join(' ').toLowerCase().includes(q));
  document.getElementById('guide-count').textContent=rows.length+' 篇实用指南';const host=document.getElementById('guide-grid');host.replaceChildren();
  rows.forEach((g,i)=>{const a=local(undefined,'#guide/'+g.id,'guide-card');a.style.setProperty('--i',i);const look=guideLooks[g.id]||[g.icon,'clay'];a.dataset.tone=look[1];const art=make('div',undefined,'guide-card-art');art.append(icon(look[0]),make('span',String(guideRows.indexOf(g)+1).padStart(2,'0'),'guide-no'));const metaRow=make('div',undefined,'guide-card-meta');metaRow.append(make('span',g.category),make('span','阅读指南 ↗'));const body=make('div',undefined,'guide-card-body');body.append(metaRow,make('h2',g.title),make('p',g.summary));const tags=make('div',undefined,'guide-tags');(g.tags||[]).forEach(t=>tags.append(make('span',t)));body.append(tags);a.append(art,body);host.append(a)});
  if(!rows.length)empty(host,()=>{guideCategory='全部';document.getElementById('guide-search').value='';renderGuides()});
 }
 async function renderArticle(id){
  const requestId=++articleRequest;
  const article=document.getElementById('guide-article');article.replaceChildren();
  article.append(local('← 全部校园指南','#guides','life-back'));
  const loading=make('div',undefined,'guide-loading');loading.setAttribute('role','status');loading.append(make('h1','正在打开指南'),make('p','稍等一下，步骤马上就来。'));loading.querySelector('h1').id='guide-article-title';article.append(loading);article.setAttribute('aria-busy','true');
  let g=null;
  try{g=await window.CduApi.guide(id);if(requestId!==articleRequest)return}catch(error){
    if(requestId!==articleRequest)return;
    loading.remove();article.setAttribute('aria-busy','false');
    if(error.status===404){const h=make('h1','这篇指南还不存在。');h.id='guide-article-title';article.append(h,make('p','返回指南列表，查看已经整理好的内容。'));return}
    failure(article,'这篇指南没有取到：'+(error.message||'网络异常'),()=>renderArticle(id));article.querySelector('.life-empty h2').id='guide-article-title';return;
  }
  loading.remove();article.setAttribute('aria-busy','false');document.getElementById('guides-page').setAttribute('aria-labelledby','guide-article-title');
  const header=make('header',undefined,'guide-detail-header');header.append(make('p',g.category+' / 操作指南','life-kicker'),make('h1',g.title),make('p',g.scope,'life-lead'));article.append(header);
  header.querySelector('h1').id='guide-article-title';
  const layout=make('div',undefined,'guide-detail-layout'),toc=make('aside',undefined,'guide-toc'),body=make('div',undefined,'guide-steps');toc.setAttribute('aria-label','本篇步骤');toc.append(make('h2','这篇怎么用'));
  if(g.caution){const warning=make('div',undefined,'guide-context');warning.append(make('strong','使用前看一眼'),make('p',g.caution));body.append(warning)}
  (g.sections||[]).forEach((s,i)=>{const sec=make('section',undefined,'guide-step');sec.id='life-step-'+i;const number=String(i+1).padStart(2,'0');sec.append(make('span',number,'step-no'),make('h2',s.title));const ul=make('ul');(s.items||[]).forEach(t=>ul.append(make('li',t)));sec.append(ul);body.append(sec);const b=make('button',number+'  '+s.title);b.type='button';b.addEventListener('click',()=>{sec.scrollIntoView({behavior:reduced.matches?'instant':'smooth',block:'start'});sec.tabIndex=-1;sec.focus({preventScroll:true})});toc.append(b)});
  if(g.faqs?.length){const faq=make('section',undefined,'guide-faq');faq.append(make('h2','你可能还会问'));g.faqs.forEach(f=>{const d=make('details');d.append(make('summary',f.q),make('p',f.a));faq.append(d)});body.append(faq)}
  const source=make('details',undefined,'guide-source');source.append(make('summary','资料依据与适用范围'),make('p',g.source_note||''));
  (g.sources||[]).forEach(item=>{const line=make('p');if(item.url)line.append(external(item.label,item.url));else line.append(make('span',item.label));if(item.page_ref)line.append(make('span',' · '+item.page_ref));if(item.note)line.append(make('span',' · '+item.note));source.append(line)});
  source.append(make('p','整理于 '+(meta.published_at||'').slice(0,10)+'。这是资料整理日期，不代表已核实当前系统或本学期规定。'));body.append(source);
  if(g.related_service)body.append(local('遇到问题，查校园查询 ↗','#services','life-action'));
  layout.append(toc,body);article.append(layout);requestAnimationFrame(()=>{document.title='成大早知道 · '+g.title});
 }
 async function copyPhone(b,value){let copied=false;try{await navigator.clipboard.writeText(value);copied=true}catch(_){const t=make('textarea',value);t.style.cssText='position:fixed;opacity:0';document.body.append(t);t.select();try{copied=document.execCommand('copy')}catch(_){}t.remove();b.focus()}
  b.textContent=copied?'✓':'复制';b.setAttribute('aria-label',copied?'已复制号码 '+value:'复制号码 '+value);document.getElementById('life-copy-status').textContent=copied?'已复制号码 '+value:'无法自动复制，号码为 '+value;setTimeout(()=>{if(b.isConnected){b.textContent='复制';b.setAttribute('aria-label','复制号码 '+value)}},1800)}
 function phoneGroup(s){if(s.id.startsWith('college-')||s.id==='zhanglan-college')return '学院';if(s.id==='shiling-police')return '校外服务';return '校级部门与组织'}
 function renderServices(){
  const groups=['校级部门与组织','学院','校外服务'];
  chips('service-filters',groups,serviceCategory,v=>{serviceCategory=v;renderServices()});
  const q=query('service-search');const rows=serviceRows.filter(s=>(s.phone||'').trim()&&[s.title,s.owner,s.phone||''].join(' ').toLowerCase().includes(q)&&(serviceCategory==='全部'||phoneGroup(s)===serviceCategory));
  document.getElementById('service-count').textContent=rows.length+' 个电话';const host=document.getElementById('service-grid');host.replaceChildren();
  groups.filter(group=>serviceCategory==='全部'||group===serviceCategory).forEach(group=>{
   const members=rows.filter(s=>phoneGroup(s)===group);if(!members.length)return;
   const section=make('section',undefined,'service-group');section.append(make('h3',group));const list=make('div',undefined,'service-group-list');
   members.forEach(s=>{const row=make('article',undefined,'service-row');row.dataset.service=s.id;row.append(make('h4',s.title.replace(/咨询$/,'')));const numbers=(s.phone||'').split(/[，,、;；/|]+/).map(n=>n.trim()).filter(Boolean);const contacts=make('div',undefined,'service-row-numbers');numbers.forEach(number=>{const item=make('div',undefined,'service-phone-row'),phone=make('a',number,'service-phone');phone.href='tel:'+number.replace(/[^\d+]/g,'');phone.setAttribute('aria-label','拨打'+number);const copy=make('button','复制','service-copy-phone');copy.type='button';copy.addEventListener('click',()=>copyPhone(copy,number));item.append(phone,copy);contacts.append(item)});row.append(contacts);list.append(row)});
   section.append(list);host.append(section);
  });
  if(!rows.length)empty(host,()=>{serviceCategory='全部';document.getElementById('service-search').value='';renderServices()});
  const note=make('p','学院号码摘自 2026 级新生《入学指南》；其他号码以对应单位官网为准。','service-list-note');host.append(note);
 }
 async function route(){
  const sequence=++routeRequest;
  const page=document.body.dataset.page;if(page!=='guides'){articleRequest++;return}
  const isServices=location.hash==='#services',id=location.hash.startsWith('#guide/')?location.hash.slice(7):null;
  const guidePage=document.getElementById('guides-page');guidePage.dataset.guideView=id?'article':isServices?'services':'index';guidePage.setAttribute('aria-labelledby',id?'guide-article-title':'guides-heading');
  if(!id)articleRequest++;
  document.getElementById('guide-index').hidden=!!id||isServices;document.getElementById('guide-article').hidden=!id;document.getElementById('services-page').hidden=!isServices;
  document.querySelectorAll('[data-life-tab]').forEach(a=>{if(a.getAttribute('href')===(isServices?'#services':'#guides'))a.setAttribute('aria-current','page');else a.removeAttribute('aria-current')});
  try{
   if(id){if(lastGuide!==id)window.scrollTo({top:0,behavior:'instant'});await renderArticle(id)}
   else if(isServices){await loadServices();if(sequence!==routeRequest)return;renderServices()}
   else {await loadGuides();if(sequence!==routeRequest)return;renderGuides()}
  }catch(_){/* 失败状态已由各加载函数渲染 */}
  if(sequence===routeRequest)lastGuide=id;
 }
 document.getElementById('guide-search').addEventListener('input',()=>{if(guidesLoaded)renderGuides()});
 document.getElementById('service-search').addEventListener('input',()=>{if(servicesLoaded)renderServices()});
 document.addEventListener('cdu:view',route);window.CduInitialViewReady=route();
})();
