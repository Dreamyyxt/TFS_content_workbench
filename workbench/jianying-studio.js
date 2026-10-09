/* Browser transport only. Editing is performed by the installed upstream Skill. */
(() => {
  const $=id=>document.getElementById(id), base='http://127.0.0.1:4191/api/jianying/';
  let token='', assets=[], source={}, busy=false, requestId=null;
  const message=text=>$('jyMessage').textContent=text;
  async function api(route,options={}) {
    const response=await fetch(base+route,{...options,headers:{Authorization:'Bearer '+token,...options.headers},signal:AbortSignal.timeout(120000)});
    if (!response.ok) {const error=await response.json().catch(()=>({}));throw Error(error.error || '连接失败 '+response.status);}
    return response;
  }
  const post=(route,body)=>api(route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json());
  async function connect(){
    try {
      const r=await fetch(base+'session',{headers:{'X-Jianying-Studio':'1'},signal:AbortSignal.timeout(4000)});
      if (!r.ok) throw Error('连接器未就绪');
      token=(await r.json()).token;await refresh();
    } catch(e){$('jyStatus').textContent='尚未连接 Mac。请运行“启动剪映制作.command”，并允许浏览器访问本地网络。';}
  }
  function renderAssets(){
    $('jyAssets').replaceChildren();
    assets.forEach((asset,i)=>{
      const li=document.createElement('li');li.append(document.createTextNode(asset.name));
      [['上移',()=>{if(i){[assets[i-1],assets[i]]=[assets[i],assets[i-1]];renderAssets();}}],['移除',()=>{assets.splice(i,1);renderAssets();}]].forEach(([label,fn])=>{
        const b=document.createElement('button');b.type='button';b.textContent=label;b.className='btn btn-ghost btn-sm';b.disabled=busy;b.onclick=()=>{requestId=null;fn();};li.append(b);
      });$('jyAssets').append(li);
    });
  }
  $('jyFiles').onchange=async e=>{
    if (busy){e.target.value='';return;}
    if (!token){message('请先连接 Mac');e.target.value='';return;}
    const files=[...e.target.files];
    if(files.length+assets.length>30 || files.some(f=>f.size>100*1024*1024)){message('最多30个素材，单个不超过100MB');return;}
    busy=true;$('jySubmit').disabled=true;
    try{for(const file of files){message('上传：'+file.name);assets.push(await (await api('assets?name='+encodeURIComponent(file.name),{method:'POST',body:file})).json());}requestId=null;message('素材已上传，可调整顺序。');}
    catch(e){message(e.message);}finally{busy=false;$('jySubmit').disabled=false;e.target.value='';renderAssets();}
  };
  $('jyImport').onchange=async e=>{const file=e.target.files[0];if(!file)return;if(file.size>120000){message('脚本文件过大');return;}$('jyScript').value=(await file.text()).slice(0,30000);source={};$('jySource').textContent='外部脚本：'+file.name;requestId=null;};
  window.addEventListener('jianying-script',e=>{source={script_id:e.detail.id,content_id:e.detail.material_id || e.detail.id,account:e.detail.account};$('jyTitle').value=e.detail.title || '美甲作品';$('jyScript').value=e.detail.content || '';$('jySource').textContent='来自拍摄辅助 · '+(e.detail.account || '')+' · '+(e.detail.title || '');requestId=null;});
  $('jyForm').addEventListener('input',()=>requestId=null);
  $('jyForm').onsubmit=async e=>{e.preventDefault();if(busy)return;if(!token || !assets.length){message('请连接 Mac 并上传素材');return;}busy=true;$('jySubmit').disabled=true;renderAssets();requestId ||= crypto.randomUUID();
    try{await post('jobs',{...source,request_id:requestId,title:$('jyTitle').value,script:$('jyScript').value,captions:$('jyCaptions').value,instructions:$('jyNotes').value,duration:Number($('jyDuration').value),asset_ids:assets.map(a=>a.id)});message('任务已提交。Mac 将调用剪映 Skill。');await refresh();}
    catch(e){message(e.message);}finally{busy=false;$('jySubmit').disabled=false;renderAssets();}
  };
  const labels={queued:'等待 Mac',building:'正在生成工程',draft_ready:'剪映工程已生成',finished:'已上传成片',failed:'生成失败'};
  async function refresh(){
    if(!token)return;
    const [status,jobs]=await Promise.all([api('status').then(r=>r.json()),api('jobs').then(r=>r.json())]);
    $('jyStatus').textContent=status.online ? (status.device.ready ? 'Mac 已连接 · 剪映 Skill '+status.device.skill_version : 'Mac 未就绪：'+status.device.error) : 'Mac 执行器离线；已提交任务仍保存在本机。';
    $('jyJobs').replaceChildren();
    if(!jobs.length){$('jyJobs').textContent='暂无制作任务。';return;}
    for(const job of jobs.reverse()){
      const card=document.createElement('article');card.className='jy-job';
      const title=document.createElement('h4');title.textContent=job.title+' · '+labels[job.status];card.append(title);
      const summary=document.createElement('p');summary.textContent=job.assets.length+' 个素材 · '+job.duration+' 秒'+(job.script_id?' · 已关联拍摄脚本':'');card.append(summary);
      if(job.error){const p=document.createElement('p');p.textContent=job.error;card.append(p);}
      if(job.status==='failed'){const b=document.createElement('button');b.textContent='重试';b.onclick=()=>post('jobs/'+job.id+'/retry',{}).then(refresh).catch(e=>message(e.message));card.append(b);}
      if(job.draft_path){const code=document.createElement('code');code.textContent=job.draft_path;card.append(code);const p=document.createElement('p');p.textContent='在剪映中选择“文件 → 找回草稿”，打开上述工程文件夹。脚本与备注保存在 production-notes.md。检查后在剪映内导出 MP4，再上传成片。';card.append(p);
        const input=document.createElement('input');input.type='file';input.accept='.mp4';input.setAttribute('aria-label','上传剪映导出的 MP4');input.onchange=async()=>{if(!input.files[0])return;try{await api('jobs/'+job.id+'/final',{method:'POST',body:input.files[0]});await refresh();}catch(e){message(e.message);}};card.append(input);
      }
      if(job.status==='finished'){const b=document.createElement('button');b.textContent='预览成片';b.onclick=async()=>{try{const blob=await (await api('jobs/'+job.id+'/final')).blob();const video=document.createElement('video');video.controls=true;video.src=URL.createObjectURL(blob);video.onloadeddata=()=>URL.revokeObjectURL(video.src);b.replaceWith(video);}catch(e){message(e.message);}};card.append(b);}
      $('jyJobs').append(card);
    }
  }
  $('jyConnect').onclick=connect;$('jyRefresh').onclick=()=>refresh().catch(e=>message(e.message));
  setInterval(()=>{if(document.getElementById('view-video').classList.contains('is-active'))refresh().catch(()=>{});},5000);
})();
