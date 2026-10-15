/* Shared read-only projections for the creative workspace. Dates use Shanghai time. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object' && module.exports) module.exports=api;
  else root.StudioWorkflow=api;
})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  const sameId=(a,b)=>a!=null && b!=null && String(a)===String(b);
  function validDay(value){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(value)))return false;
    const date=new Date(value+'T00:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10)===value;
  }
  function dayKey(value){
    if(arguments.length===0)value=new Date();
    if(typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value))return validDay(value)?value:'';
    if(value==null || value==='')return '';
    const date=new Date(value);
    if(!Number.isFinite(date.getTime()))return '';
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
    const part=type=>parts.find(p=>p.type===type).value;
    return part('year')+'-'+part('month')+'-'+part('day');
  }
  function shiftDay(day,offset){
    if(!validDay(day))return '';
    const date=new Date(day+'T00:00:00Z');
    date.setUTCDate(date.getUTCDate()+offset);
    return date.toISOString().slice(0,10);
  }
  function weekDays(anchor){
    if(!validDay(anchor))return [];
    const offset=(new Date(anchor+'T00:00:00Z').getUTCDay()+6)%7;
    const monday=shiftDay(anchor,-offset);
    return Array.from({length:7},(_,i)=>shiftDay(monday,i));
  }
  function rowsOnDay(rows,day){
    return rows.filter(r=>dayKey(r.publish_at)===day).slice().sort((a,b)=>new Date(a.publish_at)-new Date(b.publish_at));
  }
  const metricForSchedule=(row,metrics)=>metrics.find(m=>sameId(m.schedule_id,row.id)) || null;
  const isScriptScheduled=(script,rows)=>rows.some(r=>sameId(r.script_id,script.id));
  function filterScripts(entries,{query='',account='全部',status='all'}={}){
    const term=query.trim().toLocaleLowerCase();
    return entries.filter(({script,scan,scheduled})=>
      (account==='全部' || script.account===account) &&
      (!term || [script.title,script.account,script.content].join(' ').toLocaleLowerCase().includes(term)) &&
      (status==='all' || status==='scheduled' && scheduled || status==='unplanned' && !scheduled || status==='review' && scan.hits.length>0));
  }
  function filterMaterials(rows,scripts,{query='',account='全部',selectedOnly=false,form='全部',status='all'}={}){
    const term=query.trim().toLocaleLowerCase();
    return rows.filter(row=>{
      const hasScript=scripts.some(script=>sameId(script.material_id,row.id));
      return (account==='全部'||row.account===account) && (!selectedOnly||row.selected) &&
        (form==='全部'||row.content_form===form) &&
        (status==='all'||status==='written'&&hasScript||status==='unwritten'&&!hasScript) &&
        (!term||[row.title,row.keywords,row.account,row.angle,row.hook,row.trend_reason].join(' ').toLocaleLowerCase().includes(term));
    });
  }
  function progressQueues(materials,scripts,plans,metrics,{now=Date.now()}={}){
    const pending=materials.filter(row=>row.selected).map(material=>({material,script:scripts.find(script=>sameId(script.material_id,material.id))||null})).filter(({script})=>!String(script?.content||'').trim());
    const open=plans.filter(row=>!metricForSchedule(row,metrics));
    const dates=open.filter(row=>row.status!=='published'&&(!dayKey(row.shoot_date)||!dayKey(row.publish_at)));
    const review=open.filter(row=>row.status==='published'||dayKey(row.publish_at)&&new Date(row.publish_at).getTime()<=now).slice().sort((a,b)=>{
      const aTime=dayKey(a.publish_at)?new Date(a.publish_at).getTime():Infinity;
      const bTime=dayKey(b.publish_at)?new Date(b.publish_at).getTime():Infinity;
      return aTime-bTime;
    });
    return {pending,dates,review};
  }
  function filterMetrics(rows,{account='全部',query='',period='all',today=dayKey()}={}){
    const term=query.trim().toLocaleLowerCase();
    const start=shiftDay(today,period==='7'?-6:-29);
    return rows.filter(row=>{
      const day=dayKey(row.publish_date);
      return (account==='全部'||row.account===account) &&
        (!term||[row.title,row.account,row.platform,row.note].join(' ').toLocaleLowerCase().includes(term)) &&
        (period==='all'||period==='undated'&&!day||['7','30'].includes(period)&&day&&day>=start&&day<=today);
    });
  }
  function sortMetrics(rows,order='newest'){
    const value=row=>{
      if(order==='newest')return dayKey(row.publish_date)||null;
      const raw=row[order==='retention'?'finish_3s':'views'];
      return raw==null||String(raw).trim()===''||!Number.isFinite(Number(raw))?null:Number(raw);
    };
    return rows.slice().sort((a,b)=>{
      const av=value(a),bv=value(b);
      if(av===null)return bv===null?0:1;
      if(bv===null)return -1;
      return typeof av==='string'?bv.localeCompare(av):bv-av;
    });
  }
  function metricSource(metric,schedules,scripts,materials){
    const plan=schedules.find(row=>sameId(row.id,metric.schedule_id));
    if(!plan)return {script:null,material:null};
    const script=scripts.find(row=>sameId(row.id,plan.script_id))||null;
    const material=materials.find(row=>sameId(row.id,plan.material_id??script?.material_id))||null;
    return {script,material};
  }
  function sortScripts(entries,order='newest'){
    return entries.slice().sort((a,b)=>{
      if(order==='title')return String(a.script.title||'').localeCompare(String(b.script.title||''),'zh-CN');
      const aTime=a.script.created_at?Date.parse(a.script.created_at):NaN;
      const bTime=b.script.created_at?Date.parse(b.script.created_at):NaN;
      if(!Number.isFinite(aTime))return Number.isFinite(bTime)?1:0;
      if(!Number.isFinite(bTime))return -1;
      return order==='oldest'?aTime-bTime:bTime-aTime;
    });
  }
  const scheduleDay=(row,mode='publish')=>dayKey(mode==='shoot'?row.shoot_date:row.publish_at);
  function nearestPlanDay(rows,{mode='publish',account='全部',today=dayKey()}={}){
    const dates=rows.filter(r=>account==='全部'||r.account===account).map(r=>scheduleDay(r,mode)).filter(Boolean).sort();
    if(dates.some(day=>weekDays(today).includes(day)))return today;
    return dates.find(day=>day>=today)||dates.at(-1)||today;
  }
  function scheduleWeek(rows,{anchor=dayKey(),mode='publish',account='全部'}={}){
    const days=weekDays(anchor);
    const filtered=rows.filter(r=>account==='全部'||r.account===account);
    const groups=days.map(day=>({day,rows:filtered.filter(r=>scheduleDay(r,mode)===day).slice().sort((a,b)=>{
      const aTime=new Date(a.publish_at).getTime(), bTime=new Date(b.publish_at).getTime();
      return (Number.isFinite(aTime)?aTime:Infinity)-(Number.isFinite(bTime)?bTime:Infinity)||String(a.title||'').localeCompare(String(b.title||''));
    })}));
    return {groups,undated:filtered.filter(r=>!scheduleDay(r,mode))};
  }
  return {progressQueues,filterMetrics,sortMetrics,metricSource,filterMaterials,sortScripts,scheduleDay,nearestPlanDay,scheduleWeek,sameId,dayKey,shiftDay,weekDays,rowsOnDay,metricForSchedule,isScriptScheduled,filterScripts};
});
