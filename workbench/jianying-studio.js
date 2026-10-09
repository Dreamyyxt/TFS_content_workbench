/* Production UI: Jianying edits real media; Volcengine generates from confirmed scripts. */
(() => {
  const $=id=>document.getElementById(id), base='http://127.0.0.1:4191/api/jianying/';
  let token='',assets=[],source={},busy=false,mode='edit',requestId=null,jobsSignature='',refreshing=false,generation={ready:false},device={online:false};
  const thumbs=new Map(),outputs=new Map();
  const message=(text,error=false)=>{$('jyMessage').textContent=text;$('jyMessage').style.color=error?'var(--danger)':'';};
  async function api(route,options={}){
    const r=await fetch(base+route,{...options,headers:{Authorization:'Bearer '+token,...options.headers},signal:AbortSignal.timeout(120000)});
    if(!r.ok){const e=await r.json().catch(()=>({}));throw Error(e.error || '请求失败 '+r.status);}return r;
  }
  const post=(route,body)=>api(route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json());
  function connection(){
    const text=mode==='edit'?(device.online?(device.device.ready?'剪映已连接 · Skill '+device.device.skill_version:'剪映未就绪：'+device.device.error):'剪映执行器离线，请启动本机制作服务。'):(generation.ready?'火山方舟已连接 · 将根据拍摄脚本生成视频':(generation.error || '正在检查火山连接…'));
    $('jyStatus').textContent=text;$('jyStatus').classList.toggle('is-error',mode==='edit'?!device.online || !device.device?.ready:!generation.ready);
  }
  async function connect(){
    $('jyConnect').disabled=true;
    try{const r=await fetch(base+'session',{headers:{'X-Jianying-Studio':'1'},signal:AbortSignal.timeout(4000)});if(!r.ok)throw Error('制作服务未就绪');token=(await r.json()).token;
      await Promise.all([refresh(),api('generation/status').then(r=>r.json()).then(data=>{generation=data;})]);connection();$('jyConnect').textContent='重新连接';
    }catch(e){$('jyStatus').textContent='未连接本机制作服务。请运行“启动剪映制作.command”，并允许浏览器访问本地网络。';$('jyStatus').classList.add('is-error');}
    finally{$('jyConnect').disabled=false;}
  }
  function setMode(next){
    if(busy)return;mode=next;requestId=null;const gen=mode==='generate';
    for(const [id,selected] of [['jyModeEdit',!gen],['jyModeGenerate',gen]]){$(id).classList.toggle('is-active',selected);$(id).setAttribute('aria-pressed',String(selected));}
    $('jyModeHint').textContent=gen?'火山方舟 · 只需拍摄脚本 · 输出 AI 视频文件':'剪映 Skill · 必须上传照片或视频 · 输出可编辑工程';
    $('jyScript').required=gen;$('jyScriptRequired').textContent=gen?'（必填）':'（可选）';
    $('jyAssetsHeading').textContent=gen?'参考照片 · 可选':'实拍素材 · 必填';
    $('jyUploadTitle').textContent=gen?'添加参考照片':'选择照片或视频';$('jyUploadHint').textContent=gen?'也可不上传 · 最多9张 · 单张 <30MB':'也可拖入素材 · 单个 ≤100MB';
    $('jyFiles').accept=gen?'.jpg,.jpeg,.png,.webp':'.jpg,.jpeg,.png,.webp,.mp4,.mov,.m4v';
    $('jyNotesLabel').textContent=gen?'生成要求（画面、风格与节奏）':'剪辑备注（随工程保存）';
    $('jyCaptionsLabel').textContent=gen?'画面文字要求（由 AI 尝试呈现）':'画面字幕（每行一句，按时长平均分配）';
    $('jyGenAdvanced').hidden=!gen;$('jySubmit').textContent=gen?'生成视频':'开始剪辑';
    $('jyDuration').replaceChildren(...(gen?[5,10,15]:[12,20,30]).map(v=>{const o=document.createElement('option');o.value=v;o.textContent=v+' 秒';o.selected=v===(gen?5:20);return o;}));
    $('jyFormat').textContent=gen?'9:16 · 720P':'9:16 · 1080P · 30FPS';
    $('jyRules').textContent=gen?'根据脚本生成新画面与声音，参考照片可选。生成会产生火山 API 用量；成功后自动取回视频文件。':'按素材顺序剪辑，保留真实画面。短视频不足时由照片补足；脚本与备注随工程保存，供剪映内调整。';
    message(gen?'无需上传素材，填写脚本即可生成。':'选择素材后即可开始剪辑。');connection();renderAssets();
  }
  function lock(value){busy=value;for(const id of ['jySubmit','jyFiles','jyModeEdit','jyModeGenerate','jyImport'])$(id).disabled=value;renderAssets();}
  function renderAssets(){
    $('jyAssets').replaceChildren();$('jyAssetCount').textContent=assets.length+' 个';
    assets.forEach((asset,i)=>{const li=document.createElement('li');const thumb=document.createElement(thumbs.has(asset.id)?'img':'span');thumb.className='video-asset-thumb';if(thumbs.has(asset.id)){thumb.src=thumbs.get(asset.id);thumb.alt='';}else thumb.textContent=asset.type==='video'?'视频':'照片';li.append(thumb);
      const name=document.createElement('span');name.className='video-asset-name';name.textContent=asset.name;name.title=asset.name;li.append(name);
      [['↑',()=>{if(i){[assets[i-1],assets[i]]=[assets[i],assets[i-1]];renderAssets();}},'上移 '+asset.name],['×',()=>{assets.splice(i,1);if(thumbs.has(asset.id)){URL.revokeObjectURL(thumbs.get(asset.id));thumbs.delete(asset.id);}renderAssets();},'移除 '+asset.name]].forEach(([label,fn,aria])=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.setAttribute('aria-label',aria);b.disabled=busy || label==='↑'&&i===0;b.onclick=()=>{requestId=null;fn();};li.append(b);});$('jyAssets').append(li);
    });
  }
  async function upload(files){
    if(busy)return;if(!token){message('请先连接制作服务',true);return;}
    const gen=mode==='generate',max=gen?9:30,valid=/\.(jpg|jpeg|png|webp|mp4|mov|m4v)$/i;
    if(files.length+assets.length>max || files.some(f=>!valid.test(f.name)||f.size>(gen?30:100)*1024*1024 || gen&&!/\.(jpg|jpeg|png|webp)$/i.test(f.name))){message(gen?'生成模式最多9张参考照片，单张小于30MB。':'最多30个照片或视频，单个不超过100MB。',true);return;}
    lock(true);
    try{for(const file of files){message('正在上传 '+file.name+'…');const asset=await(await api('assets?name='+encodeURIComponent(file.name),{method:'POST',body:file})).json();assets.push(asset);if(asset.type==='image')thumbs.set(asset.id,URL.createObjectURL(file));}requestId=null;message('素材已添加，可调整顺序。');}
    catch(e){message(e.message,true);}finally{lock(false);$('jyFiles').value='';}
  }
  $('jyFiles').onchange=e=>upload([...e.target.files]);
  const drop=$('jyDropzone');drop.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('jyFiles').click();}};
  drop.ondragover=e=>{e.preventDefault();drop.classList.add('is-dragging');};drop.ondragleave=()=>drop.classList.remove('is-dragging');drop.ondrop=e=>{e.preventDefault();drop.classList.remove('is-dragging');upload([...e.dataTransfer.files]);};
  $('jyImport').onchange=async e=>{const file=e.target.files[0];if(!file)return;if(file.size>120000){message('脚本文件过大',true);return;}$('jyScript').value=(await file.text()).slice(0,30000);source={};$('jySource').textContent='外部脚本 · '+file.name;requestId=null;e.target.value='';};
  window.addEventListener('jianying-script',e=>{source={script_id:e.detail.id,content_id:e.detail.material_id || e.detail.id,account:e.detail.account};$('jyTitle').value=e.detail.title || '美甲作品';$('jyScript').value=e.detail.content || '';$('jySource').textContent='来自拍摄辅助 · '+(e.detail.account || '')+' · '+(e.detail.title || '');requestId=null;});
  $('jyForm').addEventListener('input',()=>requestId=null);
  $('jyForm').onsubmit=async e=>{e.preventDefault();if(busy)return;if(!token){message('请先连接制作服务',true);return;}if(mode==='edit'&&!assets.length){message('剪辑需要上传至少一张照片或一个视频。',true);$('jyDropzone').focus();return;}if(mode==='generate'&&assets.some(a=>a.type!=='image')){message('生成模式请移除本地视频；如需视频参考，请填写公网视频链接。',true);return;}
    lock(true);requestId ||= crypto.randomUUID();
    try{await post('jobs',{...source,mode,model:$('jyModel').value,request_id:requestId,title:$('jyTitle').value,script:$('jyScript').value,captions:$('jyCaptions').value,instructions:$('jyNotes').value,duration:Number($('jyDuration').value),asset_ids:assets.map(a=>a.id),reference_videos:$('jyReferenceVideos').value.split('\n').map(v=>v.trim()).filter(Boolean)});message(mode==='generate'?'生成任务已提交，完成后会显示视频。':'剪辑任务已提交，完成后会显示剪映工程。');await refresh();}
    catch(e){message(e.message,true);}finally{lock(false);}
  };
  const labels={queued:'等待处理',building:'剪辑中',submitting:'提交火山',generating:'AI 生成中',downloading:'取回视频',draft_ready:'工程已生成',finished:'视频已就绪',failed:'制作失败',submission_unknown:'待核对提交'};
  function button(label,fn){const b=document.createElement('button');b.type='button';b.className='btn btn-ghost btn-sm';b.textContent=label;b.onclick=async()=>{b.disabled=true;try{await fn();}catch(e){message(e.message,true);}finally{b.disabled=false;}};return b;}
  async function output(job){if(!outputs.has(job.id)){const blob=await(await api('jobs/'+job.id+'/final')).blob();outputs.set(job.id,URL.createObjectURL(blob));}return outputs.get(job.id);}
  function renderJobs(jobs){
    const tick=jobs.some(j=>['queued','submitting','generating','downloading'].includes(j.status))?Math.floor(Date.now()/5000):'';
    const signature=JSON.stringify(jobs.map(({lease_until,...job})=>job))+tick;if(signature===jobsSignature)return;jobsSignature=signature;
    const previous=new Map([...$('jyJobs').querySelectorAll('.jy-job')].map(card=>[card.dataset.jobId,card]));
    const cards=[];
    $('badgeVideo').textContent=jobs.length;$('badgeVideo').dataset.zero=jobs.length?'0':'1';
    if(!jobs.length){const empty=document.createElement('div');empty.className='empty';empty.textContent='还没有制作任务。提交后会在这里显示进度和结果。';$('jyJobs').replaceChildren(empty);return;}
    for(const job of [...jobs].reverse()){
      const oldCard=previous.get(job.id),cardSignature=JSON.stringify(job)+(['queued','submitting','generating','downloading'].includes(job.status)?tick:'');
      if(oldCard?.dataset.signature===cardSignature){cards.push(oldCard);continue;}
      const opened=new Set(oldCard?[...oldCard.querySelectorAll('details[open]')].map(d=>d.dataset.section):[]);
      const card=document.createElement('article');card.className='jy-job';card.dataset.jobId=job.id;card.dataset.signature=cardSignature;const head=document.createElement('div');head.className='video-job-head';const info=document.createElement('div'),title=document.createElement('h4');title.textContent=job.title;info.append(title);
      const summary=document.createElement('p');summary.className='video-job-meta';summary.textContent=(job.mode==='generate'?'AI 生成':'剪映剪辑')+' · '+job.duration+' 秒 · '+(job.assets.length+(job.reference_videos || []).length)+' 个素材'+(job.script_id?' · 关联拍摄脚本':'');info.append(summary);head.append(info);
      const status=document.createElement('span');status.className='video-job-status'+(['failed','submission_unknown'].includes(job.status)?' is-failed':['finished','draft_ready'].includes(job.status)?' is-done':'');status.textContent=labels[job.status] || job.status;head.append(status);card.append(head);
      if(job.mode==='generate'){
        const active=['queued','submitting','generating','downloading'].includes(job.status);
        const progress=document.createElement('div');progress.className='video-progress';
        const stages=['等待提交','火山生成','取回文件','可预览'];
        const step=job.status==='finished'?3:job.status==='downloading'?2:job.remote_id?1:0;
        const list=document.createElement('ol');list.setAttribute('aria-label','制作阶段');
        stages.forEach((label,i)=>{const li=document.createElement('li');li.textContent=label;li.className=i<step?'is-complete':i===step?'is-current':'';if(i===step)li.setAttribute('aria-current','step');list.append(li);});progress.append(list);
        const detail=document.createElement('p');detail.className='video-progress-detail';
        const seconds=Math.max(0,Math.floor((Date.parse(job.finished_at || new Date().toISOString())-Date.parse(job.created_at))/1000));
        const elapsed=seconds<60?seconds+'秒':Math.floor(seconds/60)+'分'+seconds%60+'秒';
        const remote={queued:'火山排队中',running:'火山正在生成画面与声音',succeeded:'火山生成成功',failed:'火山生成失败',expired:'火山任务已过期',cancelled:'任务已取消'};
        detail.textContent=(remote[job.remote_status] || labels[job.status])+' · '+(active?'已等待 ':'总耗时 ')+elapsed+(job.last_checked_at?' · 最近查询 '+new Date(job.last_checked_at).toLocaleTimeString('zh-CN',{hour12:false}):'');
        progress.append(detail);
        if(active){const note=document.createElement('p');note.className='hint';note.textContent='每5秒自动查询。火山未提供完成百分比，当前显示真实阶段。';progress.append(note);}
        card.append(progress);
        const promptDetails=document.createElement('details');promptDetails.dataset.section='prompt';promptDetails.open=opened.has('prompt');
        const promptSummary=document.createElement('summary');promptSummary.textContent='查看提交 Prompt 与参数';promptDetails.append(promptSummary);
        const params=document.createElement('p');params.className='video-prompt-meta';params.textContent='模型：'+job.model+' · 9:16 · 720P · '+job.duration+'秒 · 生成声音'+(job.remote_id?'\n火山任务 ID：'+job.remote_id:'')+'\n参考照片：'+job.assets.length+'张 · 参考视频：'+(job.reference_videos || []).length+'段';promptDetails.append(params);
        if(!job.prompt_recorded){const note=document.createElement('p');note.className='hint';note.textContent='此任务未留存提交时的 Prompt，下方按相同模板和已保存输入还原。';promptDetails.append(note);}
        const pre=document.createElement('pre');pre.className='video-prompt';pre.textContent=job.submitted_prompt || '';promptDetails.append(pre,button('复制 Prompt',()=>navigator.clipboard.writeText(job.submitted_prompt || '')));card.append(promptDetails);
      }
      if(job.error){const p=document.createElement('p');p.className='video-job-error';p.textContent=/has not activated/i.test(job.error)?'尚未开通所选火山视频模型，请在方舟控制台开通后重试，或选择已开通的模型。':job.error;card.append(p);if(job.mode==='generate' && /has not activated|尚未开通|权限不足/.test(job.error)){const a=document.createElement('a');a.href='https://ark.console.volcengine.com/';a.target='_blank';a.rel='noopener';a.className='btn btn-ghost btn-sm';a.textContent='打开火山方舟控制台';card.append(a);}}
      const actions=document.createElement('div');actions.className='video-job-actions';card.append(actions);
      if(job.status==='failed')actions.append(button(job.remote_id&&!job.remote_failed?'继续查询 / 下载':job.mode==='generate'?'用当前模型重试':'重试',async()=>{await post('jobs/'+job.id+'/retry',job.mode==='generate'?{model:$('jyModel').value}:{});await refresh();}));
      if(job.status==='submission_unknown'){
        const form=document.createElement('div');form.className='video-reconcile';const input=document.createElement('input');input.placeholder='控制台中的 cgt- 任务 ID';input.setAttribute('aria-label','火山任务 ID');form.append(input,button('继续查询',async()=>{await post('jobs/'+job.id+'/reconcile',{remote_id:input.value.trim()});await refresh();}));card.append(form);
      }
      if(job.draft_path){
        const details=document.createElement('details');details.dataset.section='draft';details.open=opened.has('draft');const summary=document.createElement('summary');summary.textContent='在剪映中打开工程';details.append(summary);const code=document.createElement('code');code.textContent=job.draft_path;details.append(code);const p=document.createElement('p');p.textContent='剪映“文件 → 找回草稿”选择上述文件夹。脚本和备注保存在 production-notes.md；在剪映内调整并导出 MP4。';details.append(p);card.append(details);
        actions.append(button('复制工程路径',()=>navigator.clipboard.writeText(job.draft_path)));
        const label=document.createElement('label');label.className='btn btn-ghost btn-sm video-final-upload';label.textContent='上传剪映成片';const input=document.createElement('input');input.type='file';input.accept='.mp4';input.className='visually-hidden';input.onchange=async()=>{const file=input.files[0];if(!file)return;if(file.size>100*1024*1024){message('成片最大100MB',true);return;}input.disabled=true;try{await api('jobs/'+job.id+'/final',{method:'POST',body:file});if(outputs.has(job.id)){URL.revokeObjectURL(outputs.get(job.id));outputs.delete(job.id);}await refresh();}catch(e){message(e.message,true);}finally{input.disabled=false;}};label.append(input);actions.append(label);
      }
      if(job.status==='finished'){
        actions.append(button('预览视频',async()=>{if(card.querySelector('video'))return;const video=document.createElement('video');video.controls=true;video.preload='metadata';video.src=await output(job);card.append(video);}));
        actions.append(button('下载 MP4',async()=>{const a=document.createElement('a');a.href=await output(job);a.download=job.title.replace(/[\\/:*?"<>|]/g,'-')+'.mp4';a.click();}));
      }
      if(!actions.childNodes.length)actions.remove();cards.push(card);
    }
    $('jyJobs').replaceChildren(...cards);
  }
  async function refresh(){if(!token||refreshing)return;refreshing=true;try{const [status,jobs]=await Promise.all([api('status').then(r=>r.json()),api('jobs').then(r=>r.json())]);device=status;connection();renderJobs(jobs);$('jyPollingStatus').textContent='每5秒自动刷新 · 页面最近更新 '+new Date().toLocaleTimeString('zh-CN',{hour12:false});$('jyPollingStatus').style.color='';}finally{refreshing=false;}}
  $('jyModeEdit').onclick=()=>setMode('edit');$('jyModeGenerate').onclick=()=>setMode('generate');$('jyConnect').onclick=connect;$('jyRefresh').onclick=()=>refresh().catch(e=>message(e.message,true));
  setInterval(()=>{if($('view-video').classList.contains('is-active'))refresh().catch(()=>{$('jyPollingStatus').textContent='状态刷新失败，请检查本机服务或点击重新连接。';$('jyPollingStatus').style.color='var(--danger)';});},5000);
  window.addEventListener('beforeunload',()=>{for(const url of [...thumbs.values(),...outputs.values()])URL.revokeObjectURL(url);});
  connect();
})();
