(()=>{
 'use strict';
 const catalog=window.CduData.catalog;
 const batch={records:[]},proof={records:[]};
 const core=CatalogCore;
 const display=catalog.display_options||{};
 const show=(key)=>display[key]!==false;
 const materialMap=new Map(batch.records.map(r=>[r.id,r]));
 const proofMap=new Map(proof.records.map(r=>[r.id,r]));
 const categories={sports:'运动健身',creative:'文化创作',technology:'科技竞赛',speech:'演讲表达',volunteering:'志愿服务',learning:'学习发展',exchange:'国际交流',practice:'社会实践',recruitment:'组织招募',career:'生涯就业',reference:'参考资料'};
 let visibleLimit=12,pageIndex=1,lastRows=[];const PAGE_SIZE=12;
 let serverRows=[],serverCount=0,serverPages=1,serverPage=1,renderSeq=0;
 let hasRendered=false;
 const state={view:'home',q:'',college:'',level:'',year:'',category:'',phase:'',month:'',month_basis:'seasonal',interest:'any'};
 const fieldNames={published:'原文日期',deadline:'截止时间',event_start:'活动阶段起始',audience:'参与对象片段',preparation:'准备条款',team_max:'人数条款',categories:'类别设置',song_authors:'歌曲类作者人数',digital_authors:'数智类作者人数',resolution:'分辨率要求',file_size:'文件大小',long_film:'长片时长',work_photos:'团队工作照',animation_ai:'动画 AI 比例',short_film:'超短片时长'};
 const statuses={agree:'日期及用途独立提取一致',image_agree:'图片转录一致，非自动正文核验',not_compared:'原文可定位，未做独立语义比较',missing:'独立提取待补',evidence_missing:'独立引文未定位',disagree:'提取有分歧',type_disagrees:'日期用途有分歧',value_without_support:'值与引文不符'};
 const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n};
 const link=(text,url)=>{const a=el('a',text,'source-link');a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a};
 function chinaParts(value){const raw=String(value||'');if(!raw)return null;if(!/(?:Z|[+-]\d{2}:?\d{2})$/.test(raw))return null;const d=new Date(raw);if(!Number.isFinite(d.getTime()))return null;const stamp=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(d);return {day:stamp.slice(0,10),clock:stamp.slice(11,16)}}
 function date(v,precision){if(!v)return '日期待补';const local=chinaParts(v);if(local)return local.day+(precision==='day'?'':' '+local.clock);return String(v).replace('T',' ')}
 const profileCovers=(version,kind)=>Boolean(version.content_profile?.coverage?.[kind]);
 const profileHasDatedSchedule=version=>(version.content_profile?.sections||[]).some(s=>['schedule','registration'].includes(s.kind)&&(s.items||[]).some(i=>/(?:20\d{2}[年./-]\d{1,2}|\d{1,2}月\d{1,2}日|\d{1,2}日)/.test(i.text||'')));
 function safeCduUrl(value){try{const url=new URL(value);return (url.protocol==='http:'||url.protocol==='https:')&&(url.hostname==='cdu.edu.cn'||url.hostname.endsWith('.cdu.edu.cn'))}catch(_){return false}}
 const profileNames={audience:'参与对象',conditions:'参与条件',quota:'名额与推荐',location:'地点',registration:'报名步骤',materials:'所需材料',schedule:'日程安排',fees:'费用与缴费',content:'活动内容',benefits:'奖励与保障',contact:'联系与咨询',duties:'职责要求',notes:'其他说明',other:'其他说明'};
 const kindOrder=['audience','conditions','quota','registration','materials','schedule','location','fees','benefits','contact','content','duties','notes','other'];
 const cleanListText=text=>String(text||'').replace(/^\s*(?:(?:[•·▪◦])\s*)?(?:(?:[（(]?\d{1,2}[）)]?[.、)）])\s*)+/,'');
 const displayText=text=>cleanListText(String(text||'').replace(/^\s*(?:[•·▪◦]\s*)?\d{1,2}[.、)）](?=[\u4e00-\u9fff《（])/,'').replace(/^\s*[•·▪◦]\s*/,''));
 /* 版面修复：OCR 把年份、时刻、汉字切断的地方接回去；不改写用词。 */
 const tidy=text=>String(text||'')
  .replace(/(\d)[ \u3000]*(\d)[ \u3000]*:[ \u3000]*(\d)[ \u3000]*(\d)/g,'$1$2:$3$4')
  .replace(/(\d)[ \u3000]+(\d)(?=[ \u3000]*[年月日号])/g,'$1$2')
  .replace(/(\d)[ \u3000]+(?=[年月日号时分])/g,'$1')
  .replace(/([\u4e00-\u9fff])[ \u3000]+([\u4e00-\u9fff])/g,'$1$2')
  .replace(/(\d)[ \u3000]+(?=[\u4e00-\u9fff])/g,'$1')
  .replace(/([\u4e00-\u9fff])[ \u3000]+(?=\d)/g,'$1')
  .replace(/[ \u3000]+(?=[，。；：、）】》])/g,'')
  .replace(/([（【《])[ \u3000]+/g,'$1')
  .replace(/[ \u3000]{2,}/g,' ')
  .trim();
 const normKey=text=>String(text||'').replace(/[\s\u3000，。；：、,.;:（）()「」“”"'·\-—…《》]/g,'').toLowerCase();
 const looseKey=text=>normKey(String(text||'').replace(/^\s*(?:[\u4e00-\u9fffA-Za-z]{1,10})\s*[:：]/,'').replace(/^\s*[\d一二三四五六七八九十]+[.、）)]\s*/,''));
 const boilerplateCue=/应高度重视|要充分认识|切实加强|广泛宣传|营造.{0,8}氛围|高度重视|精心组织|认真组织|务必要|确保.{0,12}(?:知晓|传达|落实)|传达至|抓紧抓实|落到实处|现将.{0,30}通知如下|特此通知|未尽事宜.{0,30}(?:另行|联系)|本通知.{0,30}(?:解释|负责)|现印发|请遵照执行|认真做好.{0,8}(?:准备|工作)|积极组织.{0,8}(?:参赛|队伍)/;
 const usefulCue=/[\d０-９]|元|免费|自理|截止|之前|前完成|月|日|时|点|名额|人数|每班|每队|推荐|报送|提交|材料|地点|地址|费用|联系|电话|邮箱|资格|条件|年级|专业|对象|报名|填写|发送|面试|笔试|答辩|学分|课程|奖项|证书|住宿|交通|餐|保险|要求|流程|步骤|作品|视频|论文|表|群|官网|平台|招聘|职责|任务|聘期|(?:[一二三四五六七八九十两]+)\s*(?:名|人|项|份|组|队|个|次|场|周|课时)|组队|队伍|场地|奖品|自备|考核|联络员|预征|PPT/;
 const leadOnly=/^\s*(?:[（(]?[一二三四五六七八九十\d]{1,3}[）)]?[.、])?\s*(?:有|具备|符合|满足)?下列.{0,12}(?:之一|条件|情形|要求)?\s*[：:]\s*$/;
 const attachmentName=/^(?:附件\s*\d*\s*[:：.、]?\s*)?[^。；]{0,60}\.(?:docx?|xlsx?|pptx?|pdf|zip|rar|jpe?g|png|doc)$/i;
 const timeKind=kind=>kind==='schedule'||kind==='registration';
 /* 只在整段都是纯套话时丢弃；带数字、动作或名额的片段一律保留。 */
 const salutationOnly=/^(?:各|全体|全校|全院)?(?:学院|班级|单位|部门|同学|教职工|师生)[：:]?$/;
 const signatureOnly=/^(?:[一-鿿]{2,20}(?:委员会|学院|办公室|团委|学生会|协会))$/;
 const officialIntro=/^为(?:贯彻|落实|深入|推进|推动|丰富|营造|促进|加强|提升|做好|响应|激发)/;
 const boilerplateOnly=text=>{
  const value=String(text||'').trim();
  if(!value)return true;
  if(leadOnly.test(value)||attachmentName.test(value)||salutationOnly.test(value)||signatureOnly.test(value)||/^附件[：:]?$/.test(value))return true;
  if(officialIntro.test(value)&&value.length>100&&/现将|请各|请遵照|认真组织|通知如下|确保/.test(value))return true;
  if(usefulCue.test(value))return false;
  return boilerplateCue.test(value);
 };
 const factVisible=fact=>{
  const text=String(fact.value||'').trim();
  if(!text)return false;
  /* 只有“日程/报名”类才排除讲者履历：材料清单里的“个人简历”是正常要求。 */
  if(timeKind(fact.kind)&&ActivityCalendarCore.isBiographical(text))return false;
  return !boilerplateOnly(text);
 };
 const noticeVisible=(text,kind)=>{
  const value=String(text||'').trim();
  if(!value)return false;
  if(timeKind(kind)&&ActivityCalendarCore.isBiographical(value))return false;
  if(boilerplateOnly(value))return false;
  return value.length>=2||/免费|自费/.test(value);
 };
 /* 先切句，再只在“下一段确实开始新栏目/新动作”的逗号处切开，避免把条件、费用拆散。 */
 const clauseLabel=/^([\u4e00-\u9fffA-Za-z]{1,10})\s*[:：]/;
 const continuation=/^(?:由|并|且|或|及|与|以及|其中|但|同时|另|如|包括|不含|按|以|向|至|到|须|需|应|可|不得|原则上|每班|每队|该|其|即|均|都|也|还|并且)/;
 const newClauseCue=/^(?:时间|日期|地点|地址|费用|收费|保险|联系人|联系方式|电话|邮箱|名额|人数|材料|报名|申报|申请|面试|笔试|答辩|截止|活动|培训|报到|作品|参赛|提交|报送|发送|缴纳|缴费|住宿|交通|餐费|对象|条件|要求|方式|步骤|流程|内容|职责|任务|安排|组别|赛道|主题|场地|每班|每队)/;
 function splitTopLevel(text){
  const out=[];let buf='',depth=0;
  for(let i=0;i<text.length;i++){
   const ch=text[i];
   if('（(【[《'.includes(ch))depth++;
   else if('）)】]》'.includes(ch)&&depth)depth--;
   if(depth===0&&/[，,；;。]/.test(ch)){
    if(ch!=='，'&&ch!==','){out.push(buf);buf='';continue}
    const rest=text.slice(i+1).trim();
    if(newClauseCue.test(rest)){out.push(buf);buf='';continue}
   }
   buf+=ch;
  }
  out.push(buf);
  return out.map(s=>s.trim()).filter(Boolean);
 }
 function splitClauses(text){
  const out=[];
  const standalone=/^(?:免费|自费|自理|线上|线下|待定|另行通知|无|否|是)$/;
  for(const sentence of String(text||'').split(/\n+/)){
   for(const raw of splitTopLevel(sentence)){
    const value=raw.replace(/[。；;，,]+$/,'').trim();
    if(!value)continue;
    if(out.length&&(continuation.test(value)||(value.length<6&&!standalone.test(value)))){out[out.length-1]+='，'+value;continue}
    out.push(value);
   }
  }
  return out;
 }
 function classifyClause(text,fallback='other'){
  const t=String(text||'').trim();
  const label=(t.match(clauseLabel)||[])[1]||'';
  if(label){
   if(/^(?:报名时间|提交时间|报送时间|截止时间|活动时间|面试时间|笔试时间|答辩时间|时间|日期|日程|安排|活动日期|举办时间|面试安排|笔试安排|答辩安排|日程安排|时间安排)$/.test(label))return 'schedule';
   if(/^(?:地点|地址|面试地点|报到地点|活动地点|场地|教室)$/.test(label))return 'location';
   if(/^(?:费用|收费|报名费|保险费|住宿费|交通费|餐费|押金|缴费|费用标准)$/.test(label))return 'fees';
   if(/^(?:联系人|联系方式|电话|邮箱|咨询|QQ|群号|咨询群)$/.test(label))return 'contact';
   if(/^(?:名额|人数|推荐|指标|名额分配)$/.test(label))return 'quota';
   if(/^(?:材料|报名材料|所需材料|附件|作品|参赛作品)$/.test(label))return 'materials';
   if(/^(?:报名|报名方式|报名步骤|申报|申请|流程|步骤|方式|报名流程)$/.test(label))return 'registration';
   if(/^(?:对象|参与对象|参赛对象|面向对象)$/.test(label))return 'audience';
   if(/^(?:资格|条件|要求|参与条件|报名条件|参赛条件|选聘条件)$/.test(label))return 'conditions';
   if(/^(?:内容|活动内容|比赛内容|主题|形式|组别|赛道|作品要求)$/.test(label))return 'content';
   if(/^(?:职责|任务|工作内容|考核|聘期)$/.test(label))return 'duties';
  }
  if(/填写|登录|提交|报送|发送|上传|报名|申报|申请|扫码|扫描.{0,6}二维码/.test(t)&&!/名额|人数|每队|每组|不超过|至少|至多|限.{0,4}(?:名|人)|指导教师|资格/.test(t))return 'registration';
  if(/奖励|奖金|奖品|证书|学分|加分|补贴|荣誉|奖项|一等奖|二等奖|三等奖|特等奖|优秀奖|冠军|亚军|季军/.test(t))return 'benefits';
  if(/费用|收费|报名费|保险费|住宿费|交通费|餐费|押金|缴费|自费|自理|免费|\d+\s*元/.test(t))return 'fees';
  if(/联系人|联系电话|电话[：:]|邮箱[：:]|@[\w.-]+|QQ群|咨询群|群号/.test(t))return 'contact';
  if(/费用|收费|报名费|保险费|住宿费|交通费|餐费|押金|缴费|自费|自理/.test(t))return 'fees';
  if(/(?:缴|交|收|付|需|共|约)[^。；]{0,12}(?:元|人民币|美元)/.test(t))return 'fees';
  if(/地点|地址|教室|会议室|楼|室|校区|场地|报到地点|面试地点/.test(t)&&!/报名.*(?:方式|流程|步骤)/.test(t))return 'location';
  if(/名额|人数|每班|每队|限.{0,6}名|推荐.{0,8}名|择优|指标|(?:招聘|招募|选聘|计划|合计|共)[^。；]{0,8}\d+\s*(?:名|人)/.test(t))return 'quota';
  if(/截止|之前|前完成|20\d{2}年|\d{1,2}月\d{1,2}日|\d{1,2}[:：]\d{2}|时间|日程|阶段/.test(t))return 'schedule';
  if(/填写|登录|提交|报送|发送|上传|报名|申报|申请/.test(t))return 'registration';
  if(/材料|报名表|推荐表|申请表|作品|视频|论文|附件|证明|身份证|学生证|简历|照片|文件/.test(t))return 'materials';
  if(/对象|资格|条件|要求|年级|专业|在校|全日制|优先|限|不含|除外|政治思想|品德|身心健康|能力/.test(t))return 'conditions';
  if(/职责|任务|工作内容|考核|聘期/.test(t))return 'duties';
  if(/内容|主题|形式|组别|赛道|比赛/.test(t))return 'content';
  return fallback==='other'?'other':fallback;
 }
 function resolveContext(text,ctx){
  let t=String(text||'').trim();
  if(/^(?:地址|地点)?\s*(?:同上|同前|同上所述|同前所述)/.test(t)){
   const subject=ctx.lastSubject;
   const paren=t.match(/同上[^（(]*[（(]([^）)]+)[）)]/);
   const location=ctx.lastLocation||(paren&&paren[1])||'原文未给出具体地址';
   return (subject?subject+'地点：':'地点：')+location;
  }
  if(/^(?:地址|地点)\s*(?:为|是|[:：])?/.test(t)&&ctx.lastSubject&&!t.startsWith(ctx.lastSubject))t=ctx.lastSubject+t;
  return t;
 }
 function updateContext(text,ctx,kind){
  const subject=String(text).match(/(面试|笔试|答辩|报到|培训|讲座|活动|比赛|决赛|初赛)/);
  if(subject)ctx.lastSubject=subject[1];
  if(kind==='location'){
   const value=String(text).replace(/^.*?(?:地点|地址)\s*(?:为|是|[:：])?\s*/,'').trim();
   if(value&&!/^同上/.test(value))ctx.lastLocation=value;
  }
 }
 function mergedProfile(version){
  const groups=new Map(),seen=new Set(),factKeys=[];
  if(version.editorial_curated){
   for(const section of version.content_profile?.sections||[]){
    const kind=section.kind;if(!kindOrder.includes(kind))continue;
    if(!groups.has(kind))groups.set(kind,{items:[]});
    for(const item of section.items||[]){const text=String(item.text||'').trim();
     const key=kind+'\n'+text;if(text&&!seen.has(key)){seen.add(key);groups.get(kind).items.push({text});}}
   }
   return groups;
  }
  const ctx={lastLocation:'',lastSubject:''};
  const add=(kind,text,locator,sourceUrl)=>{
   if(!show(kind))return;
   const key=(kind==='benefits'||kind==='quota')?normKey(text):looseKey(text);if(!key||seen.has(key))return;
   const existing=groups.get(kind)?.items||[];
   if(existing.some(item=>{const other=(kind==='benefits'||kind==='quota')?normKey(item.text):looseKey(item.text);return other.length>8&&key.length>8&&(other.includes(key)||key.includes(other))}))return;
   seen.add(key);if(!groups.has(kind))groups.set(kind,{items:[]});groups.get(kind).items.push({text,locator,sourceUrl});
  };
  const process=(raw,fallback,locator,sourceUrl,fromFact)=>{
   for(let piece of splitClauses(tidy(displayText(raw)))){
    piece=resolveContext(piece,ctx);
    if(!noticeVisible(piece,fallback))continue;
    const kind=classifyClause(piece,fallback),key=looseKey(piece);
    if(fromFact)factKeys.push(key);
    else if(factKeys.some(existing=>existing===key||(existing.length>6&&key.length>6&&(existing.includes(key)||key.includes(existing)))))continue;
    add(kind,piece,locator,sourceUrl);
    updateContext(piece,ctx,kind);
   }
  };
  for(const fact of (version.participation_facts||[])){if(!factVisible(fact))continue;
   process(fact.value,fact.kind,fact.locator,fact.source_url,true)}
  const p=version.content_profile;
  if(p&&show('full_text'))for(const section of p.sections||[]){
   for(const item of section.items||[])process(item.text,section.kind,item.locator,item.source_url,false);
  }
  return groups;
 }
 function renderGroups(parent,groups,skip,covered){
  for(const kind of kindOrder){
   if(skip&&skip.has(kind))continue;
   const group=groups.get(kind);if(!group)continue;
   /* 顶部摘要已经原样写过的句子不再在正文重复，只留补充条款。 */
   const items=group.items.filter(item=>!(officialIntro.test(item.text)&&item.text.length>100)&&!/^为确保[^。]{0,80}(?:顺利|圆满|安全)/.test(item.text)&&!(covered&&(covered.has(normKey(item.text))||covered.has(looseKey(item.text)))));
   if(!items.length)continue;
   const section=el('section',undefined,'profile-section');section.dataset.kind=kind;section.append(el('h5',profileNames[kind]||'其他说明'));
   const list=el('ul');for(const item of items){const li=el('li',item.text);if(item.locator)li.title=item.locator;list.append(li)}
   section.append(list);parent.append(section);
  }
 }
 function activityProfile(parent,version,context){
  const groups=context&&context.groups?context.groups:mergedProfile(version);
  renderGroups(parent,groups,context&&context.skip,context&&context.covered);
 }
 const now=()=>core.chinaNow();
 const filters=document.getElementById('filters');
 filters.open=false;
 for(const [id,label] of Object.entries(catalog.colleges)){if(id!=='unknown'){const pref=el('option',label);pref.value=id;document.getElementById('my-college').append(pref)}const o=el('option',label);o.value=id;document.getElementById('college').append(o)}
 for(const [id,label] of Object.entries(catalog.levels)){const o=el('option',label);o.value=id;document.getElementById('level').append(o)}
 /* 年份选项不能等首个列表响应再建：启动时 catalog.entries 为空，会把 ?year=2023 等深链直接判为无效。 */
 function knownYears(){const years=new Set((catalog.entries||[]).flatMap(e=>(e.versions||[]).map(v=>v.year)).filter(Number.isInteger));const range=(catalog.coverage||{}).range||[];const start=Number(String(range[0]||'').slice(0,4)),end=Number(String(range[1]||'').slice(0,4));if(Number.isInteger(start)&&Number.isInteger(end)&&start>2000&&end>=start)for(let y=start;y<=end;y++)years.add(y);return [...years].sort((a,b)=>b-a)}
 const knownYearList=knownYears();
 const yearControl=document.getElementById('year');yearControl.replaceChildren();for(const [value,label] of [['','全部年份'],...knownYearList.map(y=>[String(y),y+' 年']),['unknown','年份未明确']]){const o=el('option',label);o.value=value;yearControl.append(o)}
 const filterKeys=['q','college','level','year','category','phase','month','month_basis','interest'];
 function choice(parent,text,key,value){const b=el('button',text);b.type='button';b.dataset[key]=value;if(key==='category'&&value)b.dataset.activityType=value;b.setAttribute('aria-pressed','false');b.addEventListener('click',()=>{if(key==='category'&&value){const values=new Set(state.category.split(',').filter(Boolean));if(values.has(value))values.delete(value);else values.add(value);select(key,[...values].join(','))}else select(key,value)});parent.append(b)}
 const yearTabs=el('div',undefined,'year-shortcuts');yearTabs.setAttribute('role','group');yearTabs.setAttribute('aria-label','按公告年份筛选');choice(yearTabs,'全部年份','year','');for(const y of knownYearList)choice(yearTabs,String(y),'year',String(y));document.querySelector('#filters .filter-body').append(yearTabs);
 const months=document.getElementById('month-tabs');choice(months,'全年','month','');for(let i=1;i<=12;i++)choice(months,i+'月','month',String(i));choice(months,'日期待补','month','unknown');
 const types=document.getElementById('category-tabs');choice(types,'全部类型','category','');for(const id of ['sports','creative','technology','speech','volunteering','practice','recruitment'])choice(types,categories[id],'category',id);const extra=el('details',undefined,'extra-types');extra.append(el('summary','更多类型'));const extraBody=el('div');for(const id of ['learning','exchange','career'])choice(extraBody,categories[id],'category',id);extra.append(extraBody);types.append(extra);

 document.getElementById('college-policy').textContent=catalog.college_policy;
 document.getElementById('year-policy').textContent=catalog.year_policy;
 if(catalog.coverage){const c=catalog.coverage;document.getElementById('coverage').textContent='资料覆盖 '+c.range[0]+' 至 '+c.range[1]+'；精选页展示竞赛、项目、实践与招募，其他通知可在全部活动中查找。'}
 function storedCollege(){try{return localStorage.getItem('cdu-college-preference')||'any'}catch{return 'any'}}
 function readState(){const u=new URL(location.href),prevHash=readState.prev||'';readState.prev=u.hash;for(const k of filterKeys)state[k]=u.searchParams.get(k)||(k==='month_basis'?'seasonal':k==='interest'?storedCollege():'');const h=u.hash;state.view=(h==='#guides'||h==='#services'||h.startsWith('#guide/'))?'guides':h==='#registration'?'registration':['#compare','#year-comparison'].includes(h)?'compare':['#reference','#references'].includes(h)?'all':h==='#calendar'?'calendar':h==='#about'?'about':h==='#home'?'home':h==='#discover'?'discover':h==='#all'||h==='#results'||['q','college','level','year','category','phase','month'].some(k=>state[k])?'all':'home';
 if(state.view==='calendar'&&prevHash&&prevHash!=='#calendar'){for(const k of ['cal','cal_day','cal_view','cal_kind','cal_type','cal_college','cal_featured'])u.searchParams.delete(k);try{history.replaceState(null,'',u)}catch(_){}}
  if(!catalog.colleges[state.interest])state.interest='any';if(state.college&&!catalog.colleges[state.college])state.college='';if(state.level&&!catalog.levels[state.level])state.level='';state.category=[...new Set(state.category.split(',').filter(k=>categories[k]))].join(',');if(!['seasonal','event','deadline'].includes(state.month_basis))state.month_basis='seasonal';if(state.month&&!['unknown',...Array.from({length:12},(_,i)=>String(i+1))].includes(state.month))state.month='';
  for(const key of ['year','phase'])if(![...document.getElementById(key).options].some(o=>o.value===state[key]))state[key]='';}
 function saveState(){try{const u=new URL(location.href);for(const key of filterKeys){if(state[key]&&!(key==='month_basis'&&state[key]==='seasonal'))u.searchParams.set(key,state[key]);else u.searchParams.delete(key)}u.hash=state.view==='home'?'home':state.view==='about'?'about':state.view==='compare'?'compare':state.view==='all'?'all':state.view==='registration'?'registration':state.view==='calendar'?'calendar':'discover';history.replaceState(null,'',u)}catch(_){/* Local file previews can deny history writes; filtering still works. */}}
 function syncControls(){document.getElementById('month-selection').textContent=state.month?(state.month==='unknown'?'日期待补':state.month+'月'):'全年';document.getElementById('type-selection').textContent=state.category?state.category.split(',').map(k=>categories[k]||k).join('、'):'全部类型';document.querySelectorAll('[data-year]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.year===state.year)));document.getElementById('my-college').value=state.interest;document.getElementById('college-hint').textContent=state.interest==='any'?'可跳过；选择后会在这台设备记住。':'按原文明示的参与对象匹配；年级、专业等条件仍请看详情。';document.getElementById('query').value=state.q;for(const k of ['college','level','year','phase','month_basis'])document.getElementById(k).value=state[k];document.querySelectorAll('[data-month]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.month===state.month)));document.querySelectorAll('[data-category]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.category?state.category.split(',').includes(b.dataset.category):!state.category)));document.getElementById('month-help').textContent=state.month_basis==='seasonal'?'按往年参与月份查找，跨月征集只列开始月份。':state.month_basis==='deadline'?'按通知所列报名、作品提交等截止日期归类，不表示整个报名期间。':'按通知所列活动阶段归类；历史月份不代表今年安排。';document.querySelectorAll('[data-view]').forEach(a=>{if(a.dataset.view===state.view)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current')});document.getElementById('clear-query').hidden=!state.q;requestAnimationFrame(()=>{moveNav();if(!document.getElementById('query-page').hidden){const active=months.querySelector('[aria-pressed=true]');if(active){const x=active.offsetLeft-months.offsetLeft;if(x<months.scrollLeft||x+active.offsetWidth>months.scrollLeft+months.clientWidth)months.scrollLeft=Math.max(0,x-months.clientWidth/2+active.offsetWidth/2)}}});const extraCount=state.category.split(',').filter(k=>['learning','exchange','career'].includes(k)).length;extra.querySelector('summary').textContent='更多类型'+(extraCount?' · '+extraCount:'');if(extraCount)extra.open=true;document.getElementById('time-help').textContent='按北京时间 '+now().slice(0,10)+' 计算，不代表实时开放情况。'}
 function select(key,value){visibleLimit=12;pageIndex=1;dropPageParam();if(['home','about'].includes(state.view)&&value)state.view='discover';if(key==='year'){yearSelection.clear();editionSelection.clear()}state[key]=value;saveState();syncControls();render()}
 function addTag(parent,text,key,value){const b=el('button',text,'meta-tag');b.type='button';b.setAttribute('aria-label','按'+text+'筛选');b.addEventListener('click',()=>select(key,value));parent.append(b)}
 function materials(parent,entry){for(const id of entry.material_ids){const r=materialMap.get(id);if(!r)continue;if(entry.material_ids.length>1)parent.append(el('h4',r.title));parent.append(el('p',r.summary));
   for(const [key,label] of [['audience','参与对象'],['preparation','准备要求'],['event_start','原文活动日期'],['registration_end','原文报名截止']]){if(r.facts[key])parent.append(el('p',label+'：'+r.facts[key]))}
   if(r.editorial.uncertainties.length){parent.append(el('h4','仍需核实'));const ul=el('ul');r.editorial.uncertainties.forEach(x=>ul.append(el('li',x)));parent.append(ul)}
   if(r.editorial.suggestions.length){parent.append(el('h4','准备建议（编辑归纳）'));const ul=el('ul');r.editorial.suggestions.forEach(x=>ul.append(el('li',x)));parent.append(ul)}
   parent.append(el('p','材料文件：'+r.source.path,'proof-note'));if(r.source.published_on)parent.append(el('p','原文发布日期：'+r.source.published_on,'proof-note'));if(r.source.url)parent.append(link('查看公开来源',r.source.url));else parent.append(el('p','目前仅有本地材料摘要，公开来源待补齐。','proof-note'));
  }}
 function evidence(parent,entry,version){
  const record=version&&proofMap.get(version.proof_id);
  if(!show('proofs')||!record)return;
  const section=el('details',undefined,'entry-evidence');section.append(el('summary','查看原文核验依据'));
  section.append(el('p','以下摘录用于核对当前所选通知的重点字段；状态说明本轮核验范围，不代表持续监测。','proof-note'));
  const d=el('details',undefined,'proof-year');d.append(el('summary',record.year+' 年：'+record.fields.length+' 项依据'));
  record.fields.forEach(f=>{const row=el('div',undefined,'proof-field');row.append(el('strong',fieldNames[f.field]||f.field),el('div',f.withheld?'暂缓确定展示':date(f.value)),el('small',statuses[f.independent_status]||'待核实'),el('blockquote',f.quote),el('small',f.locator),link('查看原始公告',f.notice_url));if(f.source_url!==f.notice_url)row.append(link(f.method==='image_manual'?'查看赛程图':'查看原始附件',f.source_url));d.append(row)});
  section.append(d);
  section.append(el('p','核验快照 '+proof.checked_on+'；后续更正检索范围有限，未覆盖群消息、公众号和全部赛事网站更新。','proof-note'));parent.append(section);
 }
 /* 同一活动只有一个卡片：年份按钮一次只显示一个年份，同年多份通知再选用途。 */
 function yearGroups(entry){
  const groups=new Map();
  for(const version of entry.versions){
   const key=(version.year===null||version.year===undefined)?'unknown':String(version.year);
   if(!groups.has(key))groups.set(key,[]);
   groups.get(key).push(version);
  }
  for(const list of groups.values())list.sort((a,b)=>(b.published||'').localeCompare(a.published||''));
  return [...groups.entries()].sort((a,b)=>(a[0]==='unknown')-(b[0]==='unknown')||Number(b[0])-Number(a[0]));
 }
 function versionPurpose(version){
  const text=String(version.title||'')+' '+String(version.edition_label||'');
  if(/补充|延期|变更|调整|更正|改期/.test(text))return '补充或延期';
  if(/报名|招募|征集|申报|预报名/.test(text))return '报名';
  if(/决赛|路演|答辩|排位|评审|公示|立项|选拔|成绩|获奖/.test(text))return '赛程或结果';
  if(/培训|讲座|宣讲|说明会|开幕式/.test(text))return '说明或讲座';
  return '';
 }
 /* 同一通用标题下要能看出是哪个单位、哪份通知，不能只剩日期。 */
 const hostUnits={'news.cdu.edu.cn':'校级新闻网','tuanwei.cdu.edu.cn':'校级团委','xsc.cdu.edu.cn':'校级学生处','xsswzx.cdu.edu.cn':'校级学生事务中心','jw.cdu.edu.cn':'校级教务处','yjsc.cdu.edu.cn':'校级研究生处','yj.cdu.edu.cn':'校级研究生院','lib.cdu.edu.cn':'校级图书馆','kjc.cdu.edu.cn':'校级科技处','sys.cdu.edu.cn':'校级实验设备处','computer.cdu.edu.cn':'计算机学院','cxcyxy.cdu.edu.cn':'创新创业学院','oice.cdu.edu.cn':'海外教育学院','coe.cdu.edu.cn':'海外教育学院','ftva.cdu.edu.cn':'影视与动画学院','ele.cdu.edu.cn':'电子信息与电气工程学院','dfl.cdu.edu.cn':'外国语学院','jxgc.cdu.edu.cn':'机械工程学院','jztm.cdu.edu.cn':'建筑与土木工程学院','pharm.cdu.edu.cn':'药学院','yhxy.cdu.edu.cn':'基础医学院、护理学院','tyxy.cdu.edu.cn':'体育学院','zhanglan.cdu.edu.cn':'张澜学院','msys.cdu.edu.cn':'美术与设计学院','md.cdu.edu.cn':'音乐与舞蹈学院','idccaa.cdu.edu.cn':'中国-东盟艺术学院','ccaa.cdu.edu.cn':'中国-东盟艺术学院','lvyou.cdu.edu.cn':'旅游与文化产业学院','bio.cdu.edu.cn':'食品与生物工程学院','marx.cdu.edu.cn':'马克思主义学院','law.cdu.edu.cn':'法学院','med.cdu.edu.cn':'临床医学院','yxzx.cdu.edu.cn':'临床医学院','wenxin.cdu.edu.cn':'文学与新闻传播学院','sfxy.cdu.edu.cn':'师范学院'};
 function sourceUnit(version){
  try{return hostUnits[new URL(version.source_url).hostname.replace(/^www\./,'')]||''}catch(_){return ''}
 }
 function scopeLabel(version,entry){
  const source=sourceUnit(version);
  const scope=version.audience_scope||version.scope||{};
  const names=list=>[...new Set(list.filter(c=>c&&c!=='unknown').map(c=>catalog.colleges[c]).filter(Boolean))];
  let units=names(scope.colleges||[]);
  if(!units.length)units=names(version.colleges||[]);
  let label='';
  const titleUnits=entry?units.filter(name=>entry.title.includes(name)):[];
  if(titleUnits.length)label=titleUnits.slice(0,2).join('、');
  else if(scope.kind==='campus'||/^校级/.test(source))label='校级';
  else if(units.length===1)label=units[0];
  else if(units.length>1)label=units.slice(0,2).join('、');
  if(source&&source!==label&&!(label!=='校级'&&units.length===1&&source===units[0]))label=label?label+' · 来源：'+source:source;
  const base=label.split(' · ')[0];
  const redundant=Boolean(entry&&base&&(entry.title.includes(base)||(label.startsWith('校级')&&/校级/.test(entry.title))));
  return {label,redundant};
 }
 function versionLabel(version,entry){
  const purpose=versionPurpose(version);
  let base=version.edition_label?String(version.edition_label).replace(/^(\d{4})年/,'$1'):(version.year?String(version.year):'年份未明确');
  if(/^\d{4}$/.test(base))base+=' 年';
  const scope=scopeLabel(version,entry);
  return base+(scope.label&&!scope.redundant?' · '+scope.label:'')+(purpose?' · '+purpose:'')+' · '+(version.published?version.published.replaceAll('-','.'):'日期未注明');
 }
 /* 换年份/换通知时保持阅读位置：按卡片自身高度差补滚动。 */
 function swapCard(oldNode,newNode){
  const before=oldNode.getBoundingClientRect().top;
  oldNode.replaceWith(newNode);
  const after=newNode.getBoundingClientRect().top;
  const delta=after-before;
  if(Math.abs(delta)>2)window.scrollBy({top:delta,behavior:'instant'});
  newNode.querySelector('select')?.focus({preventScroll:true});
 }
 window.ActivityDetails={render:activityProfile};
 const editionSelection=new Map();const yearSelection=new Map();const linkedEdition=new URL(location.href).searchParams.get('edition');let linkedEditionApplied=false;
 function conciseAudience(value){
  const text=String(value||'');
  if(!text.trim())return '';
  const excluded=terms=>new RegExp('(?:不含|不包括|不包含|不招收|不招|不面向|不接受|不适用|不列入|排除)\\s*(?:(?:全日制|在校|全体|本校|我校|正式学籍|面向|招收|招募|报考|申请)\\s*)*(?:'+terms+')').test(text);
  const excludedAny=/不含|不包括|不包含|不招收|不招|不面向|不接受|不适用|不列入|排除/.test(text);
  const teacher=!excluded('教师|教职工|师生')&&/教师|教职工|师生/.test(text);
  const broad=!excludedAny&&/(?:全体|全校|所有)(?:在校)?(?:学生|在校生)|全校师生|全体师生/.test(text);
  const undergraduate=!excluded('本科|本专科|本[、，,\/与及和]?专科')&&/本科|本[、，,\/与及和]?专科/.test(text);
  const vocational=!excluded('专科|高职|高专')&&/专科|高职|高专/.test(text);
  const graduate=!excluded('研究生|硕士|博士')&&/研究生|硕士|博士/.test(text);
  if(broad||(undergraduate&&vocational&&graduate))return teacher?'师生':'全体学生';
  const labels=[];
  if(undergraduate||/本[、，,\/与及和]专科/.test(text))labels.push('本科生');
  if(vocational)labels.push('专科生');
  if(graduate)labels.push('研究生');
  if(teacher)labels.push('教师');
  if(!labels.length&&!excluded('学生|在校生|师生')&&/学生|在校生|师生/.test(text))labels.push('学生');
  return labels.join('、');
 }
 function audienceDetail(value){
  let text=String(value||'').replace(/\s+/g,' ').replace(/^(?:参与|申请|申报|活动|面向|招募|参赛)?对象\s*[:：]\s*/,'')
   .replace(/(?:具有|取得|拥有)(?:成都大学|我校|本校)?正式学籍的/g,'')
   .replace(/(?:成都大学|我校|本校)(?=全日制|在校|全体|本科|本[、专]|专科|研究生)/g,'');
  const protectedMark='\uE000';
  text=text.replace(/(?:不含|不包括|不包含|不招收|不招|不面向|不接受|不适用|不列入|排除|非)[^；;，,。]{0,20}/g,clause=>clause.replace(/全日制(?:在校)?/g,protectedMark))
   .replace(/全日制(?:在校)?/g,'').replaceAll(protectedMark,'全日制').replace(/在校(?=本科|本[、专]|专科|研究生)/g,'')
   .replace(/全体(?:在校)?本科(?:生|学生)/g,'本科生').replace(/本科学生/g,'本科生')
   .replace(/研究生学生/g,'研究生').replace(/(?:全校学生|全体在校学生|全体在校生)/g,'全体学生')
   .replace(/^[；;，,。\s]+|[；;，,。\s]+$/g,'').trim();
  const membersOnly=/^(?:(?:全体|全校|所有|在校|成都大学|我校|本校|本科生|专科生|本科|本专科|本[、，,\/与及和]?专科|专科|高职|高专|研究生|硕士|博士|学生|在校生|师生|教师|教职工)|[、，,\/；;与及和\s])+$/;
  if(text&&membersOnly.test(text))return conciseAudience(text)||text;
  return text;
 }
 window.ActivityDetails.audience={summary:conciseAudience,detail:audienceDetail};
 const DATE_TOKEN=/(?:20\d{2}\s*[年.\/-]\s*)?\d{1,2}\s*月\s*\d{1,2}\s*[日号]|\d{1,2}\s*月\s*\d{1,2}\s*[日晚]|20\d{2}[-.\/]\d{1,2}[-.\/]\d{1,2}/;
 function fmtDate(raw,precision){const local=chinaParts(raw);const m=String(raw||'').match(/^([0-9]{4})-([0-9]{2})-([0-9]{2})(?:[T ]([0-9]{2}):([0-9]{2}))?/);if(!m)return String(raw||'');const clock=precision==='day'?'':(local?local.clock:(m[4]?m[4]+':'+m[5]:''));return Number(m[1])+'年'+Number(m[2])+'月'+Number(m[3])+'日'+(clock?' '+clock:'')}
 function dateToken(text){const match=String(text||'').match(DATE_TOKEN);return match?match[0].replace(/\s+/g,''):''}
 function deadlineLabelOf(version){
  if(version.deadline_status==='unverified')return '历史日期（待核实）';
  if(version.deadline_status==='conflict')return '日期有冲突';
  if(version.deadline_kind==='registration')return '报名截止';
  if(version.deadline_kind==='submission')return '作品提交截止';
  if(version.deadline_kind==='combined')return '报名及作品提交截止';
  if(version.deadline_kind==='notice')return '学院汇总/推荐节点';
  return '原文所列截止';
 }
 function cardTiming(version,groupTexts){
  const result={deadline:'',event:'',deadlineLabel:'',deadlineNote:'',deadlineStatus:''};
  if(version.deadline){result.deadline=fmtDate(version.deadline,version.deadline_precision);result.deadlineLabel=deadlineLabelOf(version);result.deadlineStatus=version.deadline_status||'';result.deadlineNote=version.deadline_note||''}
  if(version.stage_status!=='unverified'&&version.stage_status!=='conflict'&&version.stage_start){result.event=fmtDate(version.stage_start)+(version.stage_end&&version.stage_end.slice(0,10)!==version.stage_start.slice(0,10)?' 起':'')}
  const allLines=['schedule','registration','location','materials','conditions','content','other'].flatMap(kind=>groupTexts(kind)||[]);
  const lines=allLines;
  const organizerOnly=/学院(?:汇总|统一|审核|收齐)|报送至|推报|组委会|评审|盖章|签字|院长|书记|学习委员|各班|教务处|研究生处|评估科/;
  const notATime=/原创|创作于|拍摄于|录制|发表|首发|须为.{0,12}(?:后|以前)|之后完成|取得.{0,8}(?:后|以来)|起算|形成时间|取得时间|有效期|学制|年龄|出生|工作年限|截止时间以/;
  if(!result.deadline){const line=lines.find(t=>/截止|前提交|前完成|前报名|前发送|前上传|前报送/.test(t)&&DATE_TOKEN.test(t)&&!organizerOnly.test(t)&&!notATime.test(t));const token=line?dateToken(line):'';if(token){result.deadline=token+'（据原文）';result.deadlineLabel='原文截止（据正文）'}}
  if(!result.event&&version.stage_status!=='unverified'&&version.stage_status!=='conflict'){
   const schedules=lines.filter(t=>DATE_TOKEN.test(t)&&!notATime.test(t));
   const explicit=schedules.find(t=>/(?:活动|比赛|初赛|决赛|面试|笔试|培训|宣讲|展演|举行|开展)时间|时间[:：]|初赛|决赛|面试|笔试|宣讲|展演|举行|开展/.test(t)&&!/截止|前提交|前完成|前报名/.test(t));
   const withClock=schedules.find(t=>/[0-9]{1,2}:[0-9]{2}|上午|下午|晚上|晚[0-9]|晚$/.test(t)&&!/截止|前提交|前完成|前报名/.test(t)&&!organizerOnly.test(t));
   const line=explicit||withClock;
   const token=line?dateToken(line):'';
   if(token)result.event=token+(/[0-9]{4}/.test(token)?'':'（原文未写年份）')+'（据原文）';
  }
  return result;
 }
 async function hydrate(entry,version,node){
  if(!version||version._full||version._loading||!version.notice_id)return;
  version._loading=true;
  try{
   const data=await window.CduApi.detail(entry.id,version.notice_id);
   const full=data.notice||{};
   version.editorial_curated=Boolean(full.editorial_curated);
   if(full.content_profile)version.content_profile=full.content_profile;
   if(full.participation_facts)version.participation_facts=full.participation_facts;
   for(const key of ['deadline','deadline_kind','deadline_precision','deadline_status','deadline_note','deadline_evidence','stage_start','stage_end','stage_status','stage_note','stage_evidence'])if(Object.prototype.hasOwnProperty.call(full,key))version[key]=full[key];
   if(Object.prototype.hasOwnProperty.call(full,'audience'))version.audience=full.audience;
   version._full=true;
   if(!node.isConnected)return;
   const next=card(entry);const box=next.querySelector('.entry-details');
   if(box)box.open=true;swapCard(node,next);
  }catch(error){
   const body=node.querySelector('.detail-content');
   if(body)body.append(el('p','详情没有加载成功：'+(error.message||'网络异常'),'profile-status'));
  }finally{version._loading=false}
 }
 function card(entry){
  const groups=yearGroups(entry),serverVersion=entry.versions.find(v=>v.source_url===entry.selected_source_url);
  const picked=editionSelection.get(entry.id),pickedVersion=entry.versions.find(v=>v.source_url===picked);
  let activeYear=yearSelection.get(entry.id);
  if(!activeYear&&pickedVersion)activeYear=String(pickedVersion.year??'unknown');
  if(!activeYear&&state.year&&groups.some(([y])=>y===state.year))activeYear=state.year;
  if(!groups.some(([y])=>y===activeYear))activeYear=String((serverVersion||entry.versions[0]).year??'unknown');
  const yearList=groups.find(([y])=>y===activeYear)?.[1]||groups[0][1];
  const version=yearList.find(v=>v.source_url===picked)||(yearList.includes(serverVersion)?serverVersion:yearList[0]);
  const a=el('article',undefined,'entry activity-card fold-entry');a.dataset.id=entry.id;
  const status=core.phase(version,entry.kind,now());
  const top=el('div',undefined,'fold-entry-meta'),category=el('span',entry.category_label,'category-tag');category.dataset.activityType=entry.category;top.append(category);
  for(const level of (version.levels||[]).filter(x=>x!=='unknown')){const b=el('button',catalog.levels[level],'scope-tag');b.type='button';b.addEventListener('click',()=>select('level',level));top.append(b)}
  top.append(el('span',status.label,'phase '+status.tone));a.append(top);
  const head=el('div',undefined,'fold-entry-head'),main=el('div',undefined,'fold-entry-main');
  const h=el('h3'),title=el('button',entry.title,'entry-title-button');title.type='button';title.setAttribute('aria-expanded','false');h.append(title);main.append(h);
  const audience=version.audience||'参与对象尚未明确，请查看原文';
  const audienceLine=el('p',undefined,'fold-audience');audienceLine.append(el('span','适合谁'),el('span',audience));audienceLine.title=audience;main.append(audienceLine);
  main.append(el('p',(version.year?version.year+' 年公告':'年份未明确')+' · '+(version.published?'发布于 '+date(version.published):'发布日期待核实'),'fold-publication'));
  const dates=el('div',undefined,'fold-dates');
  function dateRow(label,value,uncertain){const row=el('div',undefined,'fold-date'+(uncertain?' uncertain':''));row.append(el('span',label),el('strong',value));dates.append(row)}
  if(version.deadline)dateRow(deadlineLabelOf(version),fmtDate(version.deadline,version.deadline_precision),['unverified','conflict'].includes(version.deadline_status)||version.conflict);
  if(version.stage_start||version.stage_end){const note=version.stage_status==='unverified'?'活动日期待核实':version.stage_status==='conflict'||version.conflict?'活动日期有差异':'活动日期';dateRow(note,[version.stage_start,version.stage_end!==version.stage_start?version.stage_end:null].filter(Boolean).map(x=>fmtDate(x,'day')).join(' — '),note!=='活动日期')}
  if(!dates.children.length)dateRow('日期未明确','以原文安排为准',true);
  head.append(main,dates);a.append(head);
  const d=el('details',undefined,'entry-details'),summary=el('summary');summary.append(el('span','参与详情'),el('span','时间、要求与材料','fold-summary-hint'),el('span','＋','fold-plus'));d.append(summary);
  const body=el('div',undefined,'detail-content fold-detail');
  const toolbar=el('div',undefined,'fold-detail-toolbar'),reading=el('strong',(version.year||'历史')+' 年 · 参与详情');
  function closeDetail(){d.open=false;a.scrollIntoView({block:'start',behavior:reduced.matches?'instant':'smooth'});title.focus({preventScroll:true})}
  const close=el('button','收起详情 ↑','fold-close');close.type='button';close.addEventListener('click',closeDetail);toolbar.append(reading,close);body.append(toolbar);
  if(groups.length>1){const switcher=el('div',undefined,'year-switch');switcher.append(el('span','公告年份'));for(const [year] of groups){const b=el('button',year==='unknown'?'年份待核实':year+' 年','year-button');b.type='button';b.setAttribute('aria-pressed',String(year===activeYear));b.addEventListener('click',()=>{yearSelection.set(entry.id,year);editionSelection.delete(entry.id);const next=card(entry);next.querySelector('.entry-details').open=true;swapCard(a,next);hydrate(entry,next._selectedVersion,next);next.querySelector('.year-button[aria-pressed=true]')?.focus({preventScroll:true})});switcher.append(b)}body.append(switcher)}
  if(yearList.length>1){const label=el('label','本年通知版本','edition-control'),s=el('select');s.setAttribute('aria-label',entry.title+' 同年通知');yearList.forEach(v=>{const o=el('option',versionLabel(v,entry));o.value=v.notice_id;o.selected=v===version;s.append(o)});s.addEventListener('change',()=>{editionSelection.set(entry.id,yearList.find(v=>v.notice_id===s.value).source_url);const next=card(entry);next.querySelector('.entry-details').open=true;swapCard(a,next);hydrate(entry,next._selectedVersion,next)});label.append(s);body.append(label)}
  const sourcebar=el('div',undefined,'fold-sourcebar');if(safeCduUrl(version.source_url))sourcebar.append(link('核对这份原文 ↗',version.source_url));
  if(groups.filter(([y])=>y!=='unknown').length>1){const u=new URL(location.href);u.search='';u.searchParams.set('q',entry.title);u.hash='compare';const compare=el('a','比较历年安排 →','fold-compare-link');compare.href=u.href;sourcebar.append(compare)}body.append(sourcebar);
  if(!version._full){body.append(el('p','正在读取这份通知的完整要求…','fold-detail-loading'))}
  else {
   const notices=el('div',undefined,'fold-date-notes');for(const [field,label] of [['deadline','截止'],['stage','活动日期']]){if(version[field+'_note'])notices.append(el('p',label+'说明：'+version[field+'_note']));const ev=version[field+'_evidence'];if(ev?.locator){const evBox=el('details');evBox.append(el('summary',label+'依据 · '+ev.locator),el('blockquote',ev.quote||''));if(safeCduUrl(ev.source_url))evBox.append(link('查看原文',ev.source_url));notices.append(evBox)}}if(notices.children.length)body.append(notices);
   const details=mergedProfile(version),content=el('div',undefined,'fold-detail-grid');
   renderGroups(content,details);
   const audienceSection=[...content.children].find(s=>s.dataset.kind==='audience');if(!audienceSection&&version.audience){const sec=el('section',undefined,'profile-section');sec.dataset.kind='audience';sec.append(el('h5','参与对象'),el('p',version.audience));content.prepend(sec)}
   const order=['schedule','location','audience','conditions','quota','registration','materials','fees','benefits','content','contact','duties','notes','other'];
   [...content.children].sort((x,y)=>order.indexOf(x.dataset.kind)-order.indexOf(y.dataset.kind)).forEach(sec=>content.append(sec));
   const toc=el('nav',undefined,'fold-detail-nav');toc.setAttribute('aria-label','详情章节');
   for(const sec of content.children){sec.id='detail-'+entry.id+'-'+sec.dataset.kind;const b=el('button',profileNames[sec.dataset.kind]||'说明');b.type='button';b.addEventListener('click',()=>{sec.scrollIntoView({block:'start',behavior:reduced.matches?'instant':'smooth'});sec.tabIndex=-1;sec.focus({preventScroll:true})});toc.append(b)}
   body.append(toc,content);
   if(!content.children.length)body.append(el('p','暂无已提取的详细条款，请核对原文。'));
   if(entry.collegeSelections?.length){const sec=el('section',undefined,'profile-section');sec.append(el('h5','学院内部选拔'));for(const item of entry.collegeSelections){sec.append(el('p',item.text));if(safeCduUrl(item.url))sec.append(link('官方原文',item.url))}body.append(sec)}
   evidence(body,entry,version);
  }
  const end=el('button','读完了，收起并返回这条活动 ↑','fold-detail-end');end.type='button';end.addEventListener('click',closeDetail);body.append(end);d.append(body);a.append(d);
  title.addEventListener('click',()=>{d.open=!d.open});
  d.addEventListener('toggle',()=>{title.setAttribute('aria-expanded',String(d.open));a.classList.toggle('details-open',d.open);if(d.open)hydrate(entry,version,a)});
  a._selectedVersion=version;return a;
 }
 const pagerState={page:1};
 function dropPageParam(){try{const u=new URL(location.href);if(u.searchParams.has('page')){u.searchParams.delete('page');history.replaceState(null,'',u)}}catch(_){}}
 function urlPage(){const raw=Number(new URL(location.href).searchParams.get('page'));return Number.isInteger(raw)&&raw>0?raw:1}
 function pageCount(total){return Math.max(1,Math.ceil(total/PAGE_SIZE))}
 function setUrlPage(value){try{const u=new URL(location.href);if(value>1)u.searchParams.set('page',String(value));else u.searchParams.delete('page');history.pushState(null,'',u)}catch(_){}}
 function pageDateRange(rows,page){const slice=rows.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE);const dates=slice.map(r=>core.selectedVersion(r,state,now())?.published).filter(Boolean);return dates.length===slice.length&&dates.length?{newest:dates[0],oldest:dates[dates.length-1]}:null}
 let inflightKey='',successfulKey='',inflightAt=0,uiRequest=0;
 async function loadRows(){
  if(['home','about','calendar','guides'].includes(state.view))return {skipped:true,results:[]};
  const seq=++renderSeq;
  const params={view:state.view,q:state.q,year:state.year,college:state.college,level:state.level,
                month:state.month,month_basis:state.month_basis,interest:state.interest,
                categories:state.category,page:urlPage()};
  const key=JSON.stringify(params);
  if(key===successfulKey&&key===inflightKey&&Date.now()-inflightAt<800&&serverRows.length){return {count:serverCount,page:serverPage,total_pages:serverPages,results:serverRows}}
  inflightKey=key;inflightAt=Date.now();
  try{
   const data=await window.CduApi.activities(params);
   if(seq!==renderSeq)return null;
   successfulKey=key;serverRows=data.results||[];serverCount=data.count||0;
   serverPages=data.total_pages||1;serverPage=data.page||1;
   catalog.entries=serverRows;
   /* edition 深链要等首批列表到达才知道落在哪张卡；只在首次命中时应用，后续用户切换不再覆盖。 */
   if(linkedEdition&&!linkedEditionApplied){let matched=false;for(const entry of serverRows){if(entry.versions.some(v=>v.source_url===linkedEdition)){editionSelection.set(entry.id,linkedEdition);matched=true}}if(matched)linkedEditionApplied=true}
   return data;
  }catch(error){
   if(seq!==renderSeq)return null;
   serverRows=[];serverCount=0;serverPages=1;serverPage=1;
   return {error};
  }
 }
 function goPage(value){
  const pages=serverPages,next=Math.min(Math.max(1,value),pages);
  if(next===urlPage())return;
  setUrlPage(next);
  render().then(()=>{
   const list=document.getElementById('catalog-list');
   if(!list)return;
   const top=list.getBoundingClientRect().top+window.scrollY-96;
   window.scrollTo({top:Math.max(0,top),behavior:reduced.matches?'instant':'smooth'});
   const first=list.querySelector('.entry-title-button,.compare-title');if(first&&!first.matches('button'))first.tabIndex=-1;
   if(first)first.focus({preventScroll:true});
  });
 }
 function errorBlock(error){
  const box=el('div',undefined,'empty');
  box.append(el('h3','列表没有加载成功'),el('p','网络或服务暂时不可用，这不是“没有匹配的活动”。'));
  const retry=el('button','重试','primary-button');retry.type='button';
  retry.addEventListener('click',()=>render());box.append(retry);return box;
 }
 const compareSelections=new Map(),compareLoads=new Map();let compareObserver;
 const compareFields=[['audience','参与对象'],['deadline','报名 / 提交截止'],['schedule','举办时间'],['location','地点'],['registration','报名方式'],['materials','作品 / 材料'],['conditions','资格要求'],['fees','费用'],['benefits','奖励']];
 function comparisonValues(version){
  const groups=mergedProfile(version),items=kind=>(groups.get(kind)?.items||[]).map(i=>i.text).filter(Boolean);
  const monthDay=value=>{const local=chinaParts(value);const source=local?local.day+'T'+local.clock:String(value||'');return source.replace(/^(20\d{2})[-./](\d{2})[-./](\d{2})(?:T(\d{2}:\d{2})(?::\d{2})?(?:[+-]\d{2}:\d{2}|Z)?)?$/,(_,year,m,d,clock)=>Number(m)+'月'+Number(d)+'日'+(clock&&clock!=='00:00'&&version.deadline_precision!=='day'?' '+clock:'')+(version.year&&Number(year)!==Number(version.year)?Number(year)===Number(version.year)+1?'（次年）':'（'+year+'年）':''))};
  const timing=cardTiming(version,items),audiences=[...new Set([version.audience,...items('audience')].map(audienceDetail).filter(Boolean))];
  const audience=audiences.filter((text,i,all)=>!all.some((other,j)=>i!==j&&other.length>text.length&&normKey(other).includes(normKey(text)))).join('；');
  const span=version.stage_start?[monthDay(version.stage_start),version.stage_end&&version.stage_end!==version.stage_start?monthDay(version.stage_end):''].filter(Boolean).join(' — '):'';
  const cutoffLabel=version.deadline_status==='unverified'?'日期待核实：':version.deadline_status==='conflict'?'日期有冲突：':{registration:'报名：',submission:'作品提交：',combined:'报名及作品：',notice:'学院汇总/推荐：'}[version.deadline_kind]||'';
  const values={audience,deadline:version.deadline?cutoffLabel+monthDay(version.deadline):timing.deadline.replace(/20\d{2}年/g,''),schedule:span||timing.event.replace(/20\d{2}年/g,'')};
  for(const kind of ['location','registration','materials','conditions','fees','benefits'])values[kind]=items(kind).join('；');
  if(version.conflict)for(const key of ['deadline','schedule'])values[key]='';
  return values;
 }
 function comparisonState(values){const normalized=values.map(value=>String(value||'').replace(/[\s，,。；;：:]/g,'').toLowerCase());return normalized.some(value=>!value||/^(?:[-—–]+|未知|未说明|未提取|待核实|未提供|详见原文|以原文为准)$/.test(value))?'unknown':normalized.every(value=>value===normalized[0])?'same':'changed'}
 window.ActivityComparison={values:comparisonValues,status:comparisonState};
 async function loadComparisonVersion(entry,version){
  if(version._full)return;
  const key=entry.id+'|'+version.notice_id;
  if(!compareLoads.has(key))compareLoads.set(key,window.CduApi.detail(entry.id,version.notice_id).then(data=>{
   const full=data.notice;if(!full)throw new Error('通知不存在');return full;
  }).catch(error=>{compareLoads.delete(key);throw error}));
  Object.assign(version,await compareLoads.get(key),{_full:true});
 }
function comparisonCard(entry){
 const groups=yearGroups(entry).filter(([year,list])=>year!=='unknown'&&list.length);
 if(groups.length<2)return card(entry);
 const years=new Map(groups),versions=groups.flatMap(([,list])=>list);
 const byId=new Map(versions.map(version=>[String(version.notice_id),version]));
 const yearOf=version=>String(version.year);
 const stored=compareSelections.get(entry.id);
 let chosen=Array.isArray(stored)?stored.map(id=>byId.get(String(id))):[];
 if(chosen.length!==2||chosen.some(version=>!version)||yearOf(chosen[0])===yearOf(chosen[1])){
  const newer=(years.get(String(state.year))||groups[0][1])[0];
  const older=groups.find(([year])=>Number(year)<Number(newer.year))||groups.find(([year])=>year!==yearOf(newer));
  chosen=[older[1][0],newer];
 }
 chosen.sort((a,b)=>Number(a.year)-Number(b.year));
 const remembered=new Map(chosen.map(version=>[yearOf(version),String(version.notice_id)]));
 const save=()=>compareSelections.set(entry.id,chosen.map(version=>version.notice_id));
 save();
 const order=['deadline','schedule','audience','materials','registration','conditions','location','fees','benefits'];
 const labels=new Map(compareFields);
 const prefix='fold-compare-'+encodeURIComponent(String(entry.id));
 const article=el('article',undefined,'entry comparison-card fold-comparison');
 article.dataset.id=entry.id;
 const top=el('div',undefined,'entry-top');
 const category=el('span',entry.category_label,'category-tag');
 category.dataset.activityType=entry.category;
 top.append(category,el('span','两年对照','comparison-eyebrow'));
 const title=el('h3',entry.title,'compare-title');
 title.id=prefix+'-title';
 article.setAttribute('aria-labelledby',title.id);
 article.append(top,title);
 const yearbar=el('div',undefined,'compare-yearbar'),controls=[];
 for(let column=0;column<2;column++){
  const box=el('div',undefined,'compare-year');
  const label=el('label'),caption=el('span',column===0?'旧年 / 对照年':'较新年');
  const picker=el('select');
  picker.setAttribute('aria-label',entry.title+' · '+caption.textContent);
  for(const [year] of groups){const option=el('option',year+' 年');option.value=year;picker.append(option)}
  label.append(caption,picker);
  const noticeLabel=el('label'),noticeCaption=el('span'),noticePicker=el('select');
  noticeLabel.append(noticeCaption,noticePicker);
  box.append(label,noticeLabel);yearbar.append(box);
  controls.push({picker,noticeLabel,noticeCaption,noticePicker});
  picker.addEventListener('change',()=>{
   const year=picker.value;
   if(!years.has(year)||year===yearOf(chosen[1-column])){syncControls();return}
   const version=byId.get(remembered.get(year))||years.get(year)[0];
   chosen[column]=version;
   chosen.sort((a,b)=>Number(a.year)-Number(b.year));
   remembered.set(year,String(version.notice_id));
   save();syncControls();
   controls[chosen.indexOf(version)].picker.focus();
   refresh();
  });
  noticePicker.addEventListener('change',()=>{
   const version=byId.get(noticePicker.value);
   if(!version||yearOf(version)!==yearOf(chosen[column])){syncControls();return}
   chosen[column]=version;remembered.set(yearOf(version),String(version.notice_id));
   save();syncControls();refresh();
  });
 }
 article.append(yearbar);
 const status=el('p',undefined,'comparison-summary sr-only');
 status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.setAttribute('aria-atomic','true');
 const warning=el('p',undefined,'compare-warning');warning.hidden=true;
 const badges=el('nav',undefined,'compare-badges');badges.setAttribute('aria-label',entry.title+' · 对照分组');
 const content=el('div',undefined,'compare-content');
 const differences=el('section',undefined,'compare-group compare-differences');
 const differenceHeading=el('h3','两年不同之处');
 const commons=el('section',undefined,'compare-group compare-common');
 const commonHeading=el('h3','两年相同');
 const missing=el('details',undefined,'compare-group compare-missing');
 const missingHeading=el('summary','资料待补 / 资料待核实');
 const differenceBody=el('div'),commonBody=el('div'),missingBody=el('div');
 const sections=[differences,commons,missing],headings=[differenceHeading,commonHeading,missingHeading];
 const badgeButtons=[];
 sections.forEach((section,index)=>{
  section.id=prefix+'-'+['differences','common','missing'][index];
  headings[index].id=section.id+'-heading';
  if(index<2){headings[index].tabIndex=-1;section.setAttribute('aria-labelledby',headings[index].id)}
  const button=el('button',undefined,'text-button');button.type='button';
  button.setAttribute('aria-controls',section.id);
  button.addEventListener('click',()=>{
   if(index===2)missing.open=true;
   headings[index].focus({preventScroll:true});
   section.scrollIntoView({block:'start',behavior:reduced.matches?'instant':'smooth'});
  });
  badgeButtons.push(button);badges.append(button);
 });
 differences.append(differenceHeading,el('p','表述不同 ≠ 规则改变，请结合两份原文核对。','compare-note'),differenceBody);
 commons.append(commonHeading,commonBody);
 missing.append(missingHeading,missingBody);content.append(...sections);
 const bottom=el('div',undefined,'compare-bottom');
 const retry=el('button','重试读取','text-button comparison-retry');retry.type='button';retry.hidden=true;
 const sources=el('div',undefined,'comparison-sources');
 const method=el('details',undefined,'compare-method');method.append(el('summary','对照口径'),el('p','仅规范化空白与标点后比较提取文字；完全相等才合并。差异是阅读线索，不代表已经确认的规则变化。缺项、未加载和日期待核实不参与比较。'));
 bottom.append(retry,sources,method);
 article.append(status,warning,badges,content,bottom);
 let serial=0,started=false,loading=false,pending=null,pendingKey='',motion=null;

 function syncControls(){
  chosen.forEach((version,index)=>{
   const control=controls[index],year=yearOf(version),list=years.get(year);
   control.picker.value=year;
   for(const option of control.picker.options)option.disabled=option.value===yearOf(chosen[1-index]);
   control.noticeCaption.textContent=year+' 年通知';
   control.noticePicker.setAttribute('aria-label',entry.title+' · '+year+' 年通知');
   control.noticePicker.replaceChildren();
   for(const notice of list){
    const text=[notice.title||entry.title,notice.edition_label,notice.published].filter(Boolean).join(' · ');
    const option=el('option',text+'（通知 '+notice.notice_id+'）');
    option.value=String(notice.notice_id);control.noticePicker.append(option);
   }
   control.noticePicker.value=String(version.notice_id);control.noticeLabel.hidden=list.length<2;
  });
  sources.replaceChildren();
  for(const version of chosen){
   const row=el('div',undefined,'compare-source');
   row.append(el('span',version.year+' 年 · '+(version.title||entry.title)));
   if(safeCduUrl(version.source_url))row.append(link(version.year+' 年官方原文',version.source_url));
   if(version.source_url){
    const url=new URL(location.href);
    url.search='';url.searchParams.set('q',entry.title);url.searchParams.set('edition',version.source_url);url.hash='all';
    row.append(link(version.year+' 年完整版本',url.href));
   }else row.append(el('span','原文链接待补'));
   sources.append(row);
  }
 }
 function animate(){
  if(reduced.matches||!content.animate)return;
  motion?.cancel();
  motion=content.animate([{opacity:.55,transform:'translateY(4px)'},{opacity:1,transform:'translateY(0)'}],{duration:180,easing:'ease-out'});
 }
 function uncertain(version,key){
  const dateStatus=key==='deadline'?version.deadline_status:key==='schedule'?version.stage_status:'';
  return Boolean(version.conflict)||dateStatus==='unverified'||dateStatus==='conflict';
 }
 function rawNotes(value){
  if(Array.isArray(value))return value.flatMap(rawNotes);
  if(typeof value==='string')return value.trim()?[value]:[];
  if(value&&typeof value==='object')return rawNotes(value.note||value.text||value.message);
  return [];
 }
 function notesFor(version,key){
  const notes=[];
  if(key==='deadline')notes.push(...rawNotes(version.deadline_note));
  if(key==='schedule')notes.push(...rawNotes(version.stage_note));
  if(uncertain(version,key)){
   notes.push(...rawNotes(version.note),...rawNotes(version.notes));
   if(version.conflict)notes.push(...rawNotes(version.conflict),...rawNotes(version.conflict_note),...rawNotes(version.source_detail?.notes));
  }
  return [...new Set(notes)];
 }
 function fieldValue(version,key,values){
  const value=String(values[key]||'');
  if(!uncertain(version,key))return value;
  // comparisonValues suppresses conflicted dates. Keep raw values here, without validating them.
  const raw=key==='deadline'?version.deadline:key==='schedule'?[version.stage_start,version.stage_end].filter(Boolean).join(' — '):'';
  return [value,raw?'原始日期（未核实）：'+raw:''].filter(Boolean).join('\n');
 }
 function paired(row){
  const pair=el('div',undefined,'compare-pair');
  chosen.forEach((version,index)=>{
   const side=el('div',undefined,'compare-side');
   side.append(el('span',version.year+' 年','compare-year-label'));
   if(uncertain(version,row.key)){
    const dateStatus=row.key==='deadline'?version.deadline_status:version.stage_status;
    const reason=version.conflict?'通知标有冲突':dateStatus==='conflict'?'日期有冲突':'日期待核实';
    side.append(el('p','资料待核实：'+reason+'，本项不参与差异或共性判断。','compare-note'));
   }
   if(!version._full)side.append(el('p','完整通知未加载，以下仅为已知摘录，请重试读取。','compare-note'));
   side.append(el('p',row.values[index]||'本通知暂无已提取信息，不能据此认定没有要求。','comparison-value'));
   for(const note of row.notes[index])side.append(el('p','原始说明：'+note,'compare-note'));
   pair.append(side);
  });
  return pair;
 }
 function fieldArticle(row){
  const item=el('article',undefined,row.status==='changed'?'compare-change':'compare-pending');
  item.dataset.field=row.key;item.dataset.comparisonState=row.status;
  const heading=el('h4',row.label);heading.tabIndex=-1;item.append(heading);
  if(row.status!=='changed')item.append(el('p',row.status==='unverified'?'资料待核实':'资料待补','comparison-row-state'));
  if(row.values.some((value,index)=>value.length+row.notes[index].join('').length>260)){
   const preview=paired({...row,values:row.values.map(value=>value.length>120?value.slice(0,120)+'…':value),notes:[[],[]]});
   const full=el('details',undefined,'compare-full');
   const summary=el('summary','展开完整条款');
   summary.setAttribute('aria-label',row.label+' · 展开两年完整条款');
   full.append(summary,paired(row));item.append(preview,full);
   full.addEventListener('toggle',()=>{preview.hidden=full.open;summary.textContent=full.open?'收起完整条款':'展开完整条款'});
  }else item.append(paired(row));
  return item;
 }
 function paintWaiting(message){
  motion?.cancel();
  status.textContent=message;content.setAttribute('aria-busy',String(loading));
  warning.hidden=true;missing.open=false;
  missingHeading.textContent='资料待补 / 资料待核实';
  differenceBody.replaceChildren(el('p',message));
  commonBody.replaceChildren(el('p','完整通知读取后再判断共性。'));
  missingBody.replaceChildren(el('p','尚未对齐资料，不把未加载内容当成缺失或变化。'));
  badgeButtons.forEach((button,index)=>{button.textContent=['差异 —','共性 —','待核实 / 待补 —'][index];button.disabled=true});
 }
 function paintResults(failed){
  content.setAttribute('aria-busy','false');
  const values=chosen.map(comparisonValues),complete=chosen.every(version=>version._full);
  const rows=order.map(key=>{
   const texts=chosen.map((version,index)=>fieldValue(version,key,values[index]));
   const uncertainPair=chosen.some(version=>uncertain(version,key));
   return {key,label:labels.get(key)||key,values:texts,notes:chosen.map(version=>notesFor(version,key)),
    status:uncertainPair?'unverified':!complete?'unknown':comparisonState(texts)};
  });
  const changed=rows.filter(row=>row.status==='changed'),same=rows.filter(row=>row.status==='same');
  const unknown=rows.filter(row=>row.status==='unknown'),unverified=rows.filter(row=>row.status==='unverified');
  const pendingRows=rows.filter(row=>row.status==='unknown'||row.status==='unverified');
  differenceBody.replaceChildren(...changed.slice(0,3).map(fieldArticle));
  if(!changed.length)differenceBody.append(el('p',complete?'当前所选通知暂无可确认的文字差异；待补、待核实项不参与判断。':'完整通知尚未齐备，暂不判断差异。'));
  if(changed.length>3){
   const more=el('div',undefined,'compare-more');more.id=prefix+'-more';more.hidden=true;
   more.append(...changed.slice(3).map(fieldArticle));
   const expand=el('button','再看其余 '+(changed.length-3)+' 项','text-button');expand.type='button';
   expand.setAttribute('aria-controls',more.id);expand.setAttribute('aria-expanded','false');
   expand.addEventListener('click',()=>{
    more.hidden=!more.hidden;expand.setAttribute('aria-expanded',String(!more.hidden));
    expand.textContent=more.hidden?'再看其余 '+(changed.length-3)+' 项':'收起其余 '+(changed.length-3)+' 项';
    if(!more.hidden)more.firstElementChild.firstElementChild.focus({preventScroll:true});
    animate();
   });
   differenceBody.append(more,expand);
  }
  const commonText=el('p');
  if(same.length){
   commonText.append('两年相同（'+chosen.map(version=>version.year+' 年').join(' / ')+'）：');
   same.forEach((row,index)=>{
    if(index)commonText.append('；');
    commonText.append(el('strong',row.label+'：'),document.createTextNode(row.values[0]));
   });
  }else commonText.textContent=complete?'暂无可合并的相同文字。':'完整通知尚未齐备，暂不判断共性。';
  commonBody.replaceChildren(commonText);
  missing.open=false;missingHeading.textContent='资料待补 '+unknown.length+' 项 / 资料待核实 '+unverified.length+' 项';
  missingBody.replaceChildren(el('p','空值不作差异；保留每一边的已知文字。日期待核实、日期冲突或通知冲突均不计入差异与共性。','compare-note'),...pendingRows.map(fieldArticle));
  if(!pendingRows.length)missingBody.append(el('p','当前所选两份通知没有待补或待核实字段。'));
  warning.hidden=!unverified.length;
  warning.textContent=unverified.length+' 项资料待核实，不参与差异或共性判断；展开下方分组可查看原始日期和说明。';
  const counts=[changed.length,same.length,pendingRows.length];
  badgeButtons.forEach((button,index)=>{
   button.disabled=false;
   button.textContent=index===2?'待核实 '+unverified.length+' / 待补 '+unknown.length:['差异 ','共性 '][index]+counts[index];
  });
  status.textContent=failed?'部分通知读取失败；保留已知摘录，暂不判断差异与共性。请重试读取。':changed.length+' 项表述不同 · '+same.length+' 项文字相同 · '+unverified.length+' 项待核实 · '+unknown.length+' 项待补';
  retry.hidden=!failed;retry.disabled=false;
 }
 function refresh(){
  const key=JSON.stringify(chosen.map(version=>String(version.notice_id)));
  if(loading&&pendingKey===key)return pending;
  const ticket=++serial,snapshot=chosen.slice();
  started=true;loading=true;pendingKey=key;retry.disabled=true;
  paintWaiting('正在读取所选 '+snapshot.map(version=>version.year+' 年').join(' / ')+' 的完整通知…');
  pending=Promise.allSettled(snapshot.map(version=>loadComparisonVersion(entry,version))).then(results=>{
   if(ticket!==serial)return;
   loading=false;pending=null;
   const retryFocused=document.activeElement===retry;
   syncControls();
   const failed=results.some(result=>result.status==='rejected');
   paintResults(failed);animate();
   if(retryFocused&&!failed)differenceHeading.focus({preventScroll:true});
  });
  return pending;
 }
 retry.addEventListener('click',()=>refresh());
 // The existing IntersectionObserver observes .comparison-card and calls this hook.
 article._loadComparison=()=>{
  if(started&&!loading&&chosen.every(version=>version._full))return Promise.resolve();
  return refresh();
 };
 syncControls();
 if(chosen.every(version=>version._full))paintResults(false);
 else paintWaiting('进入此卡片后读取所选两年的通知；其余年份与同年通知按需加载。');
 return article;
}

 function paintResults(list,rows,previous){
  lastRows=rows;
  compareObserver?.disconnect();list.dataset.view=state.view;list.replaceChildren(...rows.map(state.view==='compare'?comparisonCard:card));
  if(state.view==='compare'){if('IntersectionObserver'in window){compareObserver=new IntersectionObserver(items=>{for(const item of items)if(item.isIntersecting){compareObserver.unobserve(item.target);item.target._loadComparison?.()}},{rootMargin:'180px'});for(const article of list.querySelectorAll('.comparison-card'))compareObserver.observe(article)}else for(const article of list.querySelectorAll('.comparison-card'))article._loadComparison?.()}
  animateResults(list,previous);
  const pages=serverPages,current=serverPage;
  if(pages<=1)return;
  const nav=el('nav',undefined,'pager');nav.setAttribute('aria-label','结果分页');
  const back=el('button','上一页','pager-button');back.type='button';back.disabled=current<=1;back.addEventListener('click',()=>goPage(current-1));nav.append(back);
  const numbers=[...new Set([1,current-1,current,current+1,pages])].filter(n=>n>=1&&n<=pages).sort((a,b)=>a-b);
  let last=0;
  for(const number of numbers){
   if(number-last>1)nav.append(el('span','…','pager-gap'));
   const button=el('button',String(number),'pager-button');button.type='button';
   if(number===current)button.setAttribute('aria-current','page');
   button.title='第 '+number+' 页';button.setAttribute('aria-label','第 '+number+' 页');
   button.addEventListener('click',()=>goPage(number));nav.append(button);last=number;
  }
  if(last<pages)nav.append(el('span','…','pager-gap'));
  const forward=el('button','下一页','pager-button');forward.type='button';forward.disabled=current>=pages;forward.addEventListener('click',()=>goPage(current+1));nav.append(forward);
  const status=el('p','第 '+current+' / '+pages+' 页 · 共 '+serverCount+' 项','pager-status');status.id='pager-status';status.setAttribute('aria-live','polite');nav.append(status);
  list.append(nav);
 }
 async function render(){const request=++uiRequest;SitePages.show(state.view);if(['home','about','calendar','guides'].includes(state.view))return;const list=document.getElementById('catalog-list');const previous=new Map([...list.querySelectorAll('article')].map(n=>[n.dataset.id,n.getBoundingClientRect()]));document.getElementById('view-description').classList.toggle('sr-only',!['registration','compare'].includes(state.view));const results=document.getElementById('results');results.setAttribute('aria-busy','true');list.inert=true;document.getElementById('count').textContent='正在查找活动…';const data=await loadRows();if(request!==uiRequest)return;results.removeAttribute('aria-busy');list.inert=false;if(!data)return;const rows=serverRows;document.getElementById('result-title').textContent='活动列表';document.getElementById('count').textContent=({discover:'精选活动',all:'全部活动',registration:'当前报名 / 提交',compare:'往届对比'}[state.view]||'活动')+' · '+serverCount+' 项结果';
  document.getElementById('view-description').textContent=state.view==='compare'?'只对齐所选两份通知：相同表述合并，其他差异逐项核对，不把缺失当作变化。':state.view==='registration'?'只列原文写明、今天还未到期的学生报名或作品提交截止；学院汇总/推荐节点和无原文依据的日期不纳入。日期不明确的记录仍可在全部活动里查看。': '优先看需要组队、准备作品或提出申请的竞赛、项目、实践与招募。时间和资格请回到原文确认。';
  paintResults(list,rows,previous);if(data.error){list.append(errorBlock(data.error))}else if(!rows.length){const e=el('div',undefined,'empty');e.append(el('h3','没有匹配的活动'),el('p',state.view==='registration'?'当前没有原文写明、且尚未到期的报名或提交机会。可以清除筛选，或到全部活动按月份查找。':state.month==='unknown'?'当前类型没有日期待补的记录。':state.month?'这个月份暂未收录匹配记录，试试全年或其他类型。':'试试其他类型，或清除筛选。'));if(state.month){const all=el('button','查看全年','text-button');all.type='button';all.addEventListener('click',()=>select('month',''));e.append(all)}if(state.interest!=='any'){const any=el('button','不限学院查看','text-button');any.type='button';any.addEventListener('click',()=>{try{localStorage.removeItem('cdu-college-preference')}catch{}select('interest','any')});e.append(any)}const b=el('button','清除全部筛选','primary-button');b.type='button';b.addEventListener('click',reset);e.append(b);list.append(e)}
  const tags=document.getElementById('active-tags');tags.replaceChildren();if(state.interest!=='any'){const b=el('button','适合 '+catalog.colleges[state.interest]+' ×','filter-tag');b.addEventListener('click',()=>{try{localStorage.removeItem('cdu-college-preference')}catch{}select('interest','any')});tags.append(b)}
  for(const key of ['q','college','level','year','category','phase','month']){if(!state[key])continue;const values=key==='category'?state.category.split(','):[state[key]];for(const value of values){const text=key==='q'?'搜索：'+value:key==='category'?categories[value]:key==='month'?(value==='unknown'?'日期待补':value+'月')+' · '+(state.month_basis==='seasonal'?'往年参与':state.month_basis==='deadline'?'所列截止':'举办时间'):document.getElementById(key).selectedOptions[0]?.textContent||value;const b=el('button',text,'filter-tag');b.type='button';b.append(el('span','×'));b.setAttribute('aria-label','移除筛选：'+text);b.addEventListener('click',()=>select(key,key==='category'?state.category.split(',').filter(k=>k!==value).join(','):''));tags.append(b)}}
  const n=['college','level','year','phase'].filter(k=>state[k]).length;filters.querySelector('summary').textContent='更多筛选'+(n?' · '+n:'');

 }
 function reset(){try{localStorage.removeItem('cdu-college-preference')}catch{}visibleLimit=12;pageIndex=1;dropPageParam();yearSelection.clear();editionSelection.clear();for(const k of filterKeys)state[k]=k==='month_basis'?'seasonal':k==='interest'?'any':'';saveState();syncControls();render()}
 document.getElementById('my-college').addEventListener('change',e=>{try{localStorage.setItem('cdu-college-preference',e.target.value)}catch{}select('interest',e.target.value)});
 document.getElementById('reset').addEventListener('click',reset);document.getElementById('clear-query').addEventListener('click',()=>select('q',''));
 document.querySelector('.skip').addEventListener('click',e=>{e.preventDefault();state.view='all';saveState();syncControls();render();const results=document.getElementById('results');results.tabIndex=-1;results.focus();results.scrollIntoView({block:'start',behavior:reduced.matches?'instant':'smooth'})});
 for(const key of ['college','level','year','phase','month_basis'])document.getElementById(key).addEventListener('change',e=>select(key,e.target.value));
 document.getElementById('query').addEventListener('input',e=>select('q',e.target.value));
 document.getElementById('views').addEventListener('click',e=>{const a=e.target.closest('[data-view]');if(!a||e.ctrlKey||e.metaKey||e.shiftKey||e.altKey||e.button!==0)return;e.preventDefault();visibleLimit=12;pageIndex=1;dropPageParam();state.view=a.dataset.view;saveState();syncControls();render()});
 addEventListener('hashchange',()=>{readState();syncControls();render()});addEventListener('popstate',()=>{readState();syncControls();render()});

 const reduced=matchMedia('(prefers-reduced-motion:reduce)');
 function moveNav(){if(document.getElementById('query-page').hidden)return;const nav=document.getElementById('views'),active=nav.querySelector('[aria-current]');if(!active)return;let line=nav.querySelector('.nav-line');if(!line){line=el('span',undefined,'nav-line');line.setAttribute('aria-hidden','true');nav.append(line)}line.style.transform='translateX('+active.offsetLeft+'px) scaleX('+active.offsetWidth+')'}
 function animateResults(list,previous){if(document.documentElement.dataset.inputMethod==='keyboard'||document.activeElement?.id==='query'||reduced.matches)return;if(!hasRendered){hasRendered=true;return}if(!Element.prototype.animate)return;let i=0;for(const n of list.querySelectorAll('article')){const old=previous.get(n.dataset.id),rect=n.getBoundingClientRect();if(reduced.matches){n.animate([{opacity:.7},{opacity:1}],{duration:70});continue}if(old){const dy=old.top-rect.top;if(Math.abs(dy)>1&&Math.abs(dy)<innerHeight)n.animate([{transform:'translateY('+dy+'px)'},{transform:'translateY(0)'}],{duration:180,easing:'cubic-bezier(.23,1,.32,1)'})}else if(i<6){n.animate([{opacity:.65,transform:'translateY(5px)'},{opacity:1,transform:'translateY(0)'}],{duration:140,delay:0,easing:'cubic-bezier(.16,1,.3,1)',fill:'backwards'});i++}}}
 document.addEventListener('toggle',event=>{if(!event.target.open||!event.target.classList.contains('entry-details'))return;const body=event.target.querySelector('.detail-content');if(body?.animate&&document.documentElement.dataset.inputMethod!=='keyboard')body.animate(reduced.matches?[{opacity:.7},{opacity:1}]:[{opacity:.4,transform:'translateY(-5px)'},{opacity:1,transform:'translateY(0)'}],{duration:reduced.matches?70:220,easing:'cubic-bezier(.16,1,.3,1)'})},true);
 addEventListener('resize',moveNav);

 readState();syncControls();render();
})();

(() => {
 'use strict';
 const page=document.getElementById('query-page');
 const original=document.querySelector('.explore-controls');
 const search=original.querySelector('.searchbox');
 const searchLabel=document.querySelector('label[for=query]');
 const workspace=page.querySelector('.explore-workspace');
 const make=(tag,text,cls)=>{const e=document.createElement(tag);if(text)e.textContent=text;if(cls)e.className=cls;return e};
 const band=make('div',null,'fold-search-band');band.append(searchLabel,search);
 const trigger=make('button','筛选条件','fold-filter-trigger');trigger.type='button';trigger.setAttribute('aria-haspopup','dialog');band.append(trigger);workspace.before(band);
 const sidebar=make('div',null,'fold-sidebar');original.replaceWith(sidebar);sidebar.append(original);
 const cap=make('div',null,'fold-filter-cap');cap.append(make('span','缩小范围'),make('small','FILTER INDEX'));original.prepend(cap);
 const presets=make('div',null,'fold-presets');presets.append(make('span','试着找'));
 for(const [label,q,hash] of [['飞盘比赛','飞盘','all'],['跆拳道往届','跆拳道','compare'],['学院推荐节点','川渝青年说','all']]){const a=make('a',label);const url=new URL(location.href);url.search='';url.searchParams.set('q',q);url.hash=hash;a.href=url.href;presets.append(a)}band.after(presets);
 const dialog=make('dialog',null,'fold-filter-dialog');dialog.setAttribute('aria-labelledby','fold-filter-title');
 const top=make('div',null,'fold-filter-dialog-head'),heading=make('h2','筛选活动');heading.id='fold-filter-title';const close=make('button','关闭 ×','fold-close');close.type='button';top.append(heading,close);
 const handle=make('div',null,'fold-sheet-handle');handle.setAttribute('aria-hidden','true');
 const host=make('div',null,'fold-filter-host');const done=make('button','查看结果','fold-filter-done');done.type='button';dialog.append(handle,top,host,done);document.body.append(dialog);
 const mobile=matchMedia('(max-width: 760px)'),reduced=matchMedia('(prefers-reduced-motion: reduce)');let previousOverflow='',motion=null,closing=false,returnFocus=trigger,afterClose=null;
 function openFilters(e){if(dialog.open)return;returnFocus=e?.currentTarget||trigger;previousOverflow=document.body.style.overflow;host.append(original);dialog.showModal();document.body.style.overflow='hidden';close.focus({preventScroll:true});if(!reduced.matches)motion=dialog.animate([{transform:'translateY(105%)'},{transform:'translateY(0)'}],{duration:440,easing:'cubic-bezier(.22,1,.36,1)'})}
 function closeFilters(callback){if(!dialog.open||closing)return;if(typeof callback==='function')afterClose=callback;closing=true;const start=getComputedStyle(dialog).transform;motion?.cancel();dialog.dataset.closing='';if(reduced.matches){dialog.close();return}motion=dialog.animate([{transform:start},{transform:'translateY(105%)'}],{duration:240,easing:'cubic-bezier(.4,0,1,1)',fill:'forwards'});motion.finished.then(()=>{if(dialog.open)dialog.close()}).catch(()=>{})}
 dialog.addEventListener('cancel',e=>{e.preventDefault();closeFilters()});
 dialog.addEventListener('close',()=>{motion?.cancel();motion=null;closing=false;delete dialog.dataset.closing;sidebar.append(original);document.body.style.overflow=previousOverflow;returnFocus.focus({preventScroll:true});const callback=afterClose;afterClose=null;callback?.()});
 trigger.addEventListener('click',openFilters);close.addEventListener('click',()=>closeFilters());done.addEventListener('click',()=>closeFilters(()=>document.getElementById('results').scrollIntoView({block:'start',behavior:'instant'})));
 dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeFilters()}});
 mobile.addEventListener('change',()=>{if(!mobile.matches)closeFilters()});
 window.addEventListener('hashchange',()=>closeFilters());
 const type=document.getElementById('type-panel');if(!mobile.matches)type.open=true;
 const count=document.getElementById('count'),tags=document.getElementById('active-tags');
 function sync(){const n=tags.querySelectorAll('button').length;trigger.textContent='筛选'+(n?' · '+n:'');done.textContent='查看结果 · '+count.textContent.replace(/^.*?·\s*/,'');const compare=location.hash==='#compare';page.dataset.foldView=compare?'compare':'list';document.getElementById('query-heading-title').textContent=compare?'这次，有什么不同？':'找到下一次参与。';page.querySelector('.editorial-deck').textContent=compare?'选两年，先看不同，再看那些没变的要求。':'先找到感兴趣的事，再展开参与的具体要求。'}
 new MutationObserver(sync).observe(count,{childList:true,subtree:true});new MutationObserver(sync).observe(tags,{childList:true});sync();
 const dock=make('nav',null,'fold-mobile-dock');dock.setAttribute('aria-label','浏览快捷操作');
 const filter=make('button','调整筛选'),up=make('button','回到结果 ↑');filter.type=up.type='button';filter.addEventListener('click',openFilters);up.addEventListener('click',()=>document.getElementById('results').scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth'}));dock.append(filter,up);document.body.append(dock);
})();
