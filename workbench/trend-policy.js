(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.TrendPolicy=api;})(globalThis,()=>{
  function published(value){
    if(typeof value==='number'||/^\d{10,13}$/.test(String(value||''))){const n=Number(value);return n<1e12?n*1000:n;}
    const s=String(value||'').trim();if(!s)return NaN;
    return Date.parse(s.replace(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/,'$1-$2-$3'));
  }
  function filter(items,days,now=Date.now()){
    const result={items:[],old:0,unknown:0,future:0};const seen=new Set();
    for(const item of items||[]){const date=published(item.publish);if(!Number.isFinite(date)){result.unknown++;continue;}if(date>now+300000){result.future++;continue;}if(date<now-days*86400000){result.old++;continue;}const id=item.url||item.title;if(!id||seen.has(id))continue;seen.add(id);result.items.push({...item,publish:new Date(date).toISOString()});}return result;
  }
  function keywords(accounts){const set=new Set();for(const a of accounts||[]){if(a.enabled===false)continue;const explicit=String(a.searchKeywords||'').split(/[,，\n、]/).map(s=>s.trim()).filter(Boolean);const fallback=/日常|搞笑|打扫/.test(a.direction)?['美甲店日常','美甲店搞笑']: /口播|经营|行业/.test(a.direction)?['美甲店经营','美甲行业']:['美甲','猫眼美甲'];for(const word of explicit.length?explicit:fallback)set.add(word.slice(0,40));}return [...set].slice(0,24);}
  function createCache(ttl=600000,max=40){const values=new Map(),pending=new Map();return async function(key,run){const now=Date.now(),old=values.get(key);if(old&&old.expires>now)return {...old.value,cached:true};if(pending.has(key))return {...await pending.get(key),cached:true};const promise=Promise.resolve().then(run);pending.set(key,promise);try{const value=await promise;if(value.ok && !(value.warnings||[]).length && !Object.values(value.platforms||{}).some(p=>p.error)){values.delete(key);values.set(key,{value,expires:Date.now()+ttl});while(values.size>max)values.delete(values.keys().next().value);}return {...value,cached:false};}finally{pending.delete(key);}};}

  const DAY=86400000;
  /* 时令节点表。只收公历固定日期：农历节日（春节 / 七夕 / 中秋）每年公历日子都变，
     写死会算错，宁可不自动推导，需要时人工补关键词。 */
  const HOLIDAYS=[
    {name:'元旦跨年',date:[1,1],lead:14,after:3,words:['跨年美甲','新年美甲']},
    {name:'情人节',date:[2,14],lead:10,after:3,words:['情人节美甲','约会美甲']},
    {name:'女神节',date:[3,8],lead:7,after:3,words:['女神节美甲','女生节美甲']},
    {name:'五一出游',date:[5,1],lead:10,after:5,words:['出游美甲','度假美甲']},
    {name:'母亲节',date:[5,10],lead:7,after:3,words:['母亲节美甲']},
    {name:'618大促',date:[6,18],lead:20,after:3,words:['618美甲','毕业季美甲']},
    {name:'开学季',date:[9,1],lead:14,after:10,words:['开学美甲','学生党美甲']},
    {name:'国庆出游',date:[10,1],lead:10,after:7,words:['国庆美甲','出游美甲']},
    {name:'万圣节',date:[10,31],lead:12,after:2,words:['万圣节美甲','暗黑美甲']},
    {name:'双11大促',date:[11,11],lead:25,after:3,words:['双11美甲','美甲团购']},
    {name:'圣诞',date:[12,25],lead:20,after:5,words:['圣诞美甲','节日美甲']}
  ];
  const SEASON_BY_MONTH=['冬季','冬季','春季','春季','春季','夏季','夏季','夏季','秋季','秋季','秋季','冬季'];
  const SEASON_WORDS={'春季':['春季美甲','清新美甲'],'夏季':['夏季美甲','清爽美甲'],'秋季':['秋季美甲','枫叶美甲'],'冬季':['冬季美甲','酒红色美甲']};
  /* 返回当前时令：season＝所处季节；active＝正在窗口内的节日；upcoming＝45 天内即将到来的节日。
     upcoming 是给「提前拍片预热」用的 —— 美甲店的节日内容要提前两三周铺。 */
  function seasons(now){
    const d=now?new Date(now):new Date();
    const y=d.getFullYear();
    const t=new Date(y,d.getMonth(),d.getDate()).getTime();
    const season=SEASON_BY_MONTH[d.getMonth()];
    const active=[{name:season,words:(SEASON_WORDS[season]||[]).slice()}];
    const upcoming=[];
    for(const h of HOLIDAYS){
      const dt=new Date(y,h.date[0]-1,h.date[1]).getTime();
      const after=(h.after==null?3:h.after)*DAY;
      if(t>=dt-h.lead*DAY&&t<=dt+after)active.push({name:h.name,words:h.words.slice()});
      else if(dt-t>after&&dt-t<=(45+h.lead)*DAY)upcoming.push({name:h.name,words:h.words.slice(),days:Math.round((dt-t)/DAY)});
    }
    upcoming.sort((a,b)=>a.days-b.days);
    return {date:new Date(t).toISOString().slice(0,10),season,active,upcoming};
  }
  /* 时令搜索词：窗口内的节日优先，其次最近一个即将到来的节日（提前布局），最后补季节词。 */
  function seasonWords(now,max=3){
    const s=seasons(now),set=new Set();
    const push=words=>{for(const w of words||[]){if(set.size<max)set.add(w);}};
    for(const a of s.active)push(a.words);
    for(const u of s.upcoming)push(u.words);
    push((SEASON_WORDS[s.season]||[]));
    return [...set].slice(0,max);
  }
  /* 实际送去搜索的关键词：账号词优先，再补时令词。
     每次采集的关键词数 = 红狐调用量（每词一次），所以两头都要设上限：
     账号词最多 max-3 个，且至少留 3 个位置给时令词 —— 否则账号词一多，时令注入就被挤没了。
     默认 max=11 → 账号词 ≤8 + 时令词 ≤3，一次采集约 9 个词。 */
  function searchKeywords(accounts,now,max=11){
    const account=keywords(accounts).slice(0,Math.max(1,max-3));
    const set=new Set(account);
    for(const w of seasonWords(now,Math.min(3,max-account.length)))set.add(w);
    return [...set].slice(0,max);
  }
  return {published,filter,keywords,createCache,seasons,seasonWords,searchKeywords};
});
