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
  return {published,filter,keywords,createCache};
});
