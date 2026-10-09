/* Video production uses the existing navigation and script records. */
(() => {
  const $ = id => document.getElementById(id);
  let token = '', assets = [], context = {}, submitting = false;
  let requestId = crypto.randomUUID();
  const blobs = new Map();
  async function api(route, options={}) {
    const response = await fetch('/api/video/' + route, {...options,headers:{Authorization:'Bearer '+token,...options.headers}});
    if(!response.ok) { let error; try { error=await response.json(); } catch { error={}; } throw Error(error.error || '请求失败'); }
    return response;
  }
  const notice = text => { $('studioNotice').textContent=text; };
  const button = (text, fn) => { const b=document.createElement('button'); b.type='button'; b.className='btn btn-ghost btn-sm'; b.textContent=text; b.onclick=()=>Promise.resolve(fn()).catch(e=>notice(e.message)); return b; };
  function renderAssets() {
    $('studioAssets').replaceChildren();
    assets.forEach((a,i)=>{ const row=document.createElement('li'); row.textContent=a.name+' · '+Math.round(a.size/1024)+' KB ';
      row.append(button('上移',()=>{ if(i>0) { [assets[i-1],assets[i]]=[assets[i],assets[i-1]]; requestId=crypto.randomUUID(); renderAssets(); } }),button('移除',()=>{assets.splice(i,1);requestId=crypto.randomUUID();renderAssets();})); $('studioAssets').append(row); });
  }
  async function refresh() {
    const jobs=await (await api('jobs')).json();
    $('studioJobs').replaceChildren();
    if(!jobs.length) $('studioJobs').textContent='尚无制作任务。上传照片和视频，提交后由 Mac 执行器自动领取。';
    for(const j of jobs.reverse()) {
      const row=document.createElement('article'); row.className='studio-job';
      const title=document.createElement('h3'); title.textContent=j.title;
      const detail=document.createElement('p'); detail.textContent=({queued:'等待 Mac 执行器',rendering:'剪辑中',review:'待审核',failed:'失败'})[j.status]+' · '+j.duration+'秒'+(j.error?' · '+j.error:'');
      row.append(title,detail);
      if(j.status==='failed') row.append(button('重试',async()=>{await api('jobs/'+j.id+'/retry',{method:'POST'});await refresh();}));
      if(j.status==='review') row.append(button('加载预览和下载',async()=>{
        if(!blobs.has(j.id)) blobs.set(j.id,URL.createObjectURL(await (await api('jobs/'+j.id+'/output')).blob()));
        const video=document.createElement('video'); video.controls=true; video.src=blobs.get(j.id);
        const link=document.createElement('a'); link.href=video.src;link.download=j.title+'.mp4';link.textContent='下载 MP4';
        row.append(video,link);
      }));
      if(j.timeline) {const details=document.createElement('details');const summary=document.createElement('summary');summary.textContent='查看时间轴';const pre=document.createElement('pre');pre.textContent=JSON.stringify(j.timeline,null,2);details.append(summary,pre);row.append(details);}
      $('studioJobs').append(row);
    }
  }
  $('studioConnect').onclick=async()=>{token=$('studioToken').value.trim();$('studioToken').value='';try {await refresh();notice('已连接。令牌仅保留在当前页面内存中。');}catch(e){notice(e.message);}};
  $('studioRefresh').onclick=()=>refresh().catch(e=>notice(e.message));
  $('studioFiles').onchange=async e=>{
    const files=Array.from(e.target.files); e.target.disabled=true;
    try {for(const file of files) {notice('上传中：'+file.name);if(file.size>100*1024*1024) throw Error('单个素材不得超过 100MB');const a=await (await api('assets?name='+encodeURIComponent(file.name),{method:'POST',body:file})).json();assets.push(a);requestId=crypto.randomUUID();renderAssets();}notice('上传完成，可调整素材顺序。');}
    catch(e){notice(e.message);}finally{e.target.disabled=false;e.target.value='';}
  };
  $('studioTitle').oninput=()=>{requestId=crypto.randomUUID();};
  $('studioDuration').onchange=()=>{requestId=crypto.randomUUID();};
  $('studioForm').onsubmit=async e=>{
    e.preventDefault(); if(submitting)return; submitting=true;$('studioSubmit').disabled=true;
    try {await api('jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...context,title:$('studioTitle').value,duration:Number($('studioDuration').value),asset_ids:assets.map(a=>a.id),request_id:requestId})});notice('任务已保存，可以关闭页面；Mac 执行器将继续处理。');await refresh();}
    catch(e){notice(e.message);}finally{submitting=false;$('studioSubmit').disabled=false;}
  };
  window.addEventListener('studio-script',e=>{context=e.detail;requestId=crypto.randomUUID();$('studioTitle').value=context.title;notice('已关联脚本：'+context.title);});
  window.addEventListener('beforeunload',()=>blobs.forEach(url=>URL.revokeObjectURL(url)));
})();
