/* Production UI: Jianying edits real media; Volcengine generates from confirmed scripts. */
(() => {
  const $=id=>document.getElementById(id);
  /* 制作服务地址：页面由本机服务出具（含局域网 / 自建域名等远程访问）→ 同源；
     其余情况（线上网页、本地直接开 file://）→ 这台电脑的回环地址。标记由本机服务注入 <head>。 */
  const servedByLocalService=!!document.querySelector('meta[name="wj-local-service"]');
  const base=(servedByLocalService?location.origin:'http://127.0.0.1:4191')+'/api/jianying/';
  let musicAsset=null,serviceReady=false,latestJobs=[],jobFilter='all',jobQuery='';
  let token='',assets=[],source={},busy=false,mode='edit',requestId=null,jobsSignature='',refreshing=false,generation={ready:false},device={online:false};
  const thumbs=new Map(),outputs=new Map();
  const message=(text,error=false)=>{$('jyMessage').textContent=text;$('jyMessage').style.color=error?'var(--danger)':'';};
  /* 页面粘贴的火山密钥（存在本机浏览器），随每个请求带给本机服务；
     服务端只在这次调用里用，不落盘、不写日志。没配就不带这个头，回落到本机原有配置
     （ARK_API_KEY 环境变量 / ~/.workbuddy/volc_mediakit.key），所以老用法不受影响。 */
  const arkKey=()=>{try{return (window.SecureStore && window.SecureStore.getArkKey && window.SecureStore.getArkKey()) || '';}catch(e){return '';}};
  async function api(route,options={}){
    const ark=arkKey();
    const r=await fetch(base+route,{...options,headers:{Authorization:'Bearer '+token,...(ark?{'X-Ark-Key':ark}:{}),...options.headers},signal:AbortSignal.timeout(120000)});
    if(!r.ok){const e=await r.json().catch(()=>({}));throw Error(e.error || '请求失败 '+r.status);}return r;
  }
  const post=(route,body)=>api(route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json());
  function renderPreparation(){
    const steps=ProductionWorkflow.preparation({mode,title:$('jyTitle').value,script:$('jyScript').value,narration:$('jyNarration').value,voice:$('jyVoiceMode').value,assets,music:$('jyMusicMode').value,hasMusic:!!musicAsset,connected:serviceReady,editReady:!!device.online&&!!device.device?.ready,generationReady:!!generation.ready});
    $('jyPreparation').replaceChildren(...steps.map(step=>{
      const li=document.createElement('li');li.className=step.ready?'is-ready':'';
      const mark=document.createElement('span');mark.className='production-ready-mark';mark.textContent=step.ready?'✓':'○';mark.setAttribute('aria-hidden','true');
      const copy=document.createElement('div'),title=document.createElement('strong'),detail=document.createElement('p');title.textContent=step.label;detail.textContent=step.detail;copy.append(title,detail);li.append(mark,copy);return li;
    }));
  }
  function filterJobs(){
    const focusedFilter=document.activeElement?.dataset.jobFilter;
    const counts={all:latestJobs.length,active:0,draft:0,finished:0,attention:0};latestJobs.forEach(job=>counts[ProductionWorkflow.group(job)]++);
    $('jyJobFilters').replaceChildren(...[['all','全部'],['active','制作中'],['draft','待导出'],['finished','成片就绪'],['attention','需处理']].map(([key,label])=>{
      const b=document.createElement('button');b.type='button';b.className='chip'+(jobFilter===key?' is-active':'');b.dataset.jobFilter=key;b.setAttribute('aria-pressed',String(jobFilter===key));b.textContent=label;
      const count=document.createElement('small');count.textContent=counts[key];b.append(count);return b;
    }));
    const visible=latestJobs.filter(job=>ProductionWorkflow.matches(job,{status:jobFilter,query:jobQuery}));
    const ids=new Set(visible.map(job=>String(job.id)));
    $('jyJobs').querySelectorAll('.jy-job').forEach(card=>card.hidden=!ids.has(card.dataset.jobId));
    $('jyJobCount').textContent='显示 '+visible.length+' / '+latestJobs.length+' 个任务';
    $('jyJobClear').hidden=jobFilter==='all'&&!jobQuery.trim();
    $('jyJobsEmpty').hidden=!latestJobs.length||!!visible.length;
    if(focusedFilter)[...$('jyJobFilters').children].find(el=>el.dataset.jobFilter===focusedFilter)?.focus({preventScroll:true});
  }
  function connection(){
    const genText=generation.ready?'火山方舟已连接 · 将根据拍摄脚本生成视频'
      :(!arkKey()?'未配置火山方舟密钥 —— 点上方「🔑 火山密钥」粘贴一次即可':(generation.error || '正在检查火山连接…'));
    const text=!serviceReady?'请连接本机制作服务。':mode==='edit'?(device.online?(device.device.ready?'剪映已连接 · Skill '+device.device.skill_version:'剪映未就绪：'+device.device.error):'剪映执行器离线，请启动本机制作服务。'):genText;
    renderPreparation();
    $('jyStatus').textContent=text;$('jyStatus').classList.toggle('is-error',!serviceReady||(mode==='edit'?!device.online || !device.device?.ready:!generation.ready));
  }
  async function connect(){
    $('jyConnect').disabled=true;
    try{const r=await fetch(base+'session',{headers:{'X-Jianying-Studio':'1'},signal:AbortSignal.timeout(4000)});if(!r.ok)throw Error('制作服务未就绪');token=(await r.json()).token;
      await Promise.all([refresh(),api('generation/status').then(r=>r.json()).then(data=>{generation=data;})]);connection();$('jyConnect').textContent='重新连接';
    }catch(e){serviceReady=false;renderPreparation();$('jyStatus').textContent='未连接本机制作服务 —— 请在这台电脑运行「启动剪映制作.command」（展开上方说明可复制脚本），并允许浏览器访问本地网络。';$('jyStatus').classList.add('is-error');}
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
    $('jyNotesLabel').textContent=gen?'生成要求（画面、风格与节奏）':'剪辑要求（用于镜头编排、配乐与节奏）';
    $('jyCaptionsLabel').textContent=gen?'画面文字要求（由 AI 尝试呈现）':'额外画面字幕（每行一句；语音字幕自动生成）';
    $('jyEditSettings').hidden=gen;
    $('jyGenAdvanced').hidden=!gen;$('jySubmit').textContent=gen?'生成视频':'开始剪辑';
    $('jyDuration').replaceChildren(...(gen?[5,10,15]:[12,20,30]).map(v=>{const o=document.createElement('option');o.value=v;o.textContent=v+' 秒';o.selected=v===(gen?5:20);return o;}));
    $('jyFormat').textContent=gen?'9:16 · 720P':'9:16 · 1080P · 30FPS';
    $('jyRules').textContent=gen?'根据脚本生成新画面与声音，参考照片可选。生成会产生火山 API 用量；成功后自动取回视频文件。':'按脚本与素材说明安排镜头，加入所选口播、同步字幕、配乐与混音，输出可编辑粗剪工程。Mac 成片在剪映内导出。';
    message(gen?'无需上传素材，填写脚本即可生成。':'选择素材后即可开始剪辑。');connection();renderAssets();
    /* 切到「生成」时重新探测一次火山连接：刚在密钥弹窗里粘贴过 key 的情况能立刻反映出来 */
    if(gen&&token)api('generation/status').then(r=>r.json()).then(d=>{generation=d;connection();}).catch(()=>{});
  }
  function lock(value){busy=value;for(const id of ['jySubmit','jyFiles','jyModeEdit','jyModeGenerate','jyImport','jyVoiceMode','jyNarration','jySpeaker','jyMusicMode','jyMusicFile','jyMusicVolume','jyNotes','jyScript','jyCaptions','jyDuration','jyTitle'])$(id).disabled=value;renderAssets();}
  /* 素材预览：缩略图直接取本机 File 的 object URL，点一下在条目标下方展开播放器/大图，
     再点一下收起。全程不上传、不下载，也不占用服务端带宽。 */
  function preview(li,asset){
    const open=li.querySelector('.video-asset-preview');
    if(open){open.remove();return;}
    const src=thumbs.get(asset.id);if(!src)return;
    const box=document.createElement(asset.type==='video'?'video':'img');
    box.className='video-asset-preview'+(asset.type==='video'?'':' video-asset-preview--image');
    box.src=src;
    if(asset.type==='video'){box.controls=true;box.playsInline=true;box.autoplay=true;}
    else box.alt=asset.name;
    li.append(box);
  }
  function renderAssets(){
    renderPreparation();
    $('jyAssets').replaceChildren();$('jyAssetCount').textContent=assets.length+' 个';
    assets.forEach((asset,i)=>{const li=document.createElement('li');
      let thumb;
      if(thumbs.has(asset.id)){
        /* 有本地缩略图时做成可点按钮：视频盖一个 ▶，点开播放；图片点开放大 */
        thumb=document.createElement('button');thumb.type='button';
        thumb.className='video-asset-thumb video-asset-thumb--'+asset.type;
        thumb.setAttribute('aria-label','预览 '+asset.name);
        if(asset.type==='video'){
          const poster=document.createElement('video');poster.src=thumbs.get(asset.id);poster.muted=true;poster.preload='metadata';poster.playsInline=true;
          const play=document.createElement('span');play.className='video-asset-play';play.textContent='▶';play.setAttribute('aria-hidden','true');
          thumb.append(poster,play);
        }else{
          const img=document.createElement('img');img.src=thumbs.get(asset.id);img.alt='';thumb.append(img);
        }
        thumb.onclick=()=>preview(li,asset);
      }else{
        thumb=document.createElement('span');thumb.className='video-asset-thumb';thumb.textContent=asset.type==='video'?'视频':'照片';
      }
      li.append(thumb);
      const name=document.createElement('span');name.className='video-asset-name';name.textContent=asset.name;name.title=asset.name;li.append(name);if(mode==='edit'){const input=document.createElement('input');input.className='video-asset-description';input.placeholder='素材内容说明（用于镜头编排）';input.value=asset.description||'';input.setAttribute('aria-label',asset.name+' 内容说明');input.disabled=busy;input.onchange=()=>{asset.description=input.value;requestId=null;};li.append(input);}
      [['↑',()=>{if(i){[assets[i-1],assets[i]]=[assets[i],assets[i-1]];renderAssets();}},'上移 '+asset.name],['×',()=>{assets.splice(i,1);if(thumbs.has(asset.id)){URL.revokeObjectURL(thumbs.get(asset.id));thumbs.delete(asset.id);}renderAssets();},'移除 '+asset.name]].forEach(([label,fn,aria])=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.setAttribute('aria-label',aria);b.disabled=busy || label==='↑'&&i===0;b.onclick=()=>{requestId=null;fn();};li.append(b);});$('jyAssets').append(li);
    });
  }
  async function upload(files){
    if(busy)return;if(!token){message('请先连接制作服务',true);return;}
    const gen=mode==='generate',max=gen?9:30,valid=/\.(jpg|jpeg|png|webp|mp4|mov|m4v)$/i;
    if(files.length+assets.length>max || files.some(f=>!valid.test(f.name)||f.size>(gen?30:100)*1024*1024 || gen&&!/\.(jpg|jpeg|png|webp)$/i.test(f.name))){message(gen?'生成模式最多9张参考照片，单张小于30MB。':'最多30个照片或视频，单个不超过100MB。',true);return;}
    lock(true);
    try{for(const file of files){message('正在上传 '+file.name+'…');const asset=await(await api('assets?name='+encodeURIComponent(file.name),{method:'POST',body:file})).json();assets.push(asset);if(asset.type!=='audio')thumbs.set(asset.id,URL.createObjectURL(file));}requestId=null;message('素材已添加，可调整顺序。');}
    catch(e){message(e.message,true);}finally{lock(false);$('jyFiles').value='';}
  }
  $('jyMusicFile').onchange=async e=>{const file=e.target.files[0];if(!file)return;if(!/\.(mp3|wav|m4a)$/i.test(file.name)||file.size>100*1024*1024){message('配乐需为100MB以内的音频文件',true);return;}lock(true);try{musicAsset=await(await api('assets?name='+encodeURIComponent(file.name),{method:'POST',body:file})).json();$('jyMusicName').textContent='已上传：'+file.name;$('jyMusicMode').value='upload';requestId=null;}catch(error){message(error.message,true);}finally{lock(false);}};
  $('jyFiles').onchange=e=>upload([...e.target.files]);
  const drop=$('jyDropzone');drop.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('jyFiles').click();}};
  drop.ondragover=e=>{e.preventDefault();drop.classList.add('is-dragging');};drop.ondragleave=()=>drop.classList.remove('is-dragging');drop.ondrop=e=>{e.preventDefault();drop.classList.remove('is-dragging');upload([...e.dataTransfer.files]);};
  $('jyImport').onchange=async e=>{const file=e.target.files[0];if(!file)return;if(file.size>120000){message('脚本文件过大',true);return;}$('jyScript').value=(await file.text()).slice(0,30000);source={};$('jySource').textContent='外部脚本 · '+file.name;requestId=null;e.target.value='';renderPreparation();};
  window.addEventListener('jianying-script',e=>{source={script_id:e.detail.id,content_id:e.detail.material_id || e.detail.id,account:e.detail.account};$('jyTitle').value=e.detail.title || '美甲作品';$('jyScript').value=e.detail.content || '';$('jySource').textContent='来自拍摄辅助 · '+(e.detail.account || '')+' · '+(e.detail.title || '');requestId=null;renderPreparation();});
  $('jyForm').addEventListener('input',()=>{requestId=null;renderPreparation();});
  $('jyForm').addEventListener('change',renderPreparation);
  /* 把一条失败的剪辑任务还原回表单，供「重新生成方案并重试」使用。
     为什么要还原而不是直接调 retry：retry 接口只是把**旧方案**重新排队，
     而剪辑失败基本都是方案本身不合格（口播超长、镜头超出素材长度），
     原样再跑一遍必然还是同一个错。所以必须重新出方案。
     素材文件都还在本机，按 id 还原列表就行（缩略图不重取，显示占位）。 */
  function restoreEditJob(job){
    const kept=(job.assets || []).filter(a=>a.type!=='audio');
    if(!kept.length)throw Error('这条任务没有可复用的素材，请重新选择素材后再剪辑');
    setMode('edit');
    for(const url of thumbs.values())URL.revokeObjectURL(url);
    thumbs.clear();assets=kept;renderAssets();
    $('jyTitle').value=job.title || '';
    $('jyScript').value=String(job.script || '');
    $('jyCaptions').value=String(job.captions || '');
    $('jyNotes').value=String(job.instructions || '');
    const o=job.edit_options || {};
    if(o.voice)$('jyVoiceMode').value=o.voice;
    if(o.speaker)$('jySpeaker').value=o.speaker;
    if(o.music)$('jyMusicMode').value=o.music;
    if(Number.isFinite(o.music_volume))$('jyMusicVolume').value=String(o.music_volume);
    /* 时长下拉是 setMode 重建的，所以要在 setMode 之后才设得进去 */
    if(job.duration&&[...$('jyDuration').options].some(x=>Number(x.value)===Number(job.duration)))$('jyDuration').value=String(job.duration);
    source={};
    renderPreparation();
    requestId=null;   /* 关键：不重置会被服务端按 request_id 判成重复任务、原样退回旧任务 */
  }
  $('jyForm').onsubmit=async e=>{e.preventDefault();if(busy)return;if(!token){message('请先连接制作服务',true);return;}if(mode==='edit'&&!assets.length){message('剪辑需要上传至少一张照片或一个视频。',true);$('jyDropzone').focus();return;}if(mode==='generate'&&assets.some(a=>a.type!=='image')){message('生成模式请移除本地视频；如需视频参考，请填写公网视频链接。',true);return;}
    lock(true);requestId ||= crypto.randomUUID();
    try{let editFields={};if(mode==='edit'){
      const options={voice:$('jyVoiceMode').value,speaker:$('jySpeaker').value,music:$('jyMusicMode').value,music_asset_id:musicAsset?.id||null,music_volume:Number($('jyMusicVolume').value)};
      if(options.music==='upload'&&!musicAsset)throw Error('请先上传配乐');
      message('正在分析脚本、素材信息和剪辑要求…');
      const inspected=await post('assets/inspect',{asset_ids:assets.map(a=>a.id)});
      /* 这份合并表才是校验该用的素材表：inspected 带 ffprobe 量出的 duration / 宽高，
         而 assets 里只有文件名和大小。之前校验误用了 assets，等于没有时长可查。 */
      const merged=inspected.map(a=>({...a,description:assets.find(x=>x.id===a.id)?.description||''}));
      const input={title:$('jyTitle').value,script:$('jyScript').value,narration:$('jyNarration').value,requirements:$('jyNotes').value,captions:$('jyCaptions').value,target_duration:Number($('jyDuration').value),voice:options.voice,assets:merged};
      if(options.voice==='tts'&&!input.narration.trim()&&!input.script.trim())throw Error('AI口播需要文案或拍摄脚本');
      /* 方案不合规就把原因回喂给模型重排，最多 3 轮：模型偶尔会给 6.68 秒的素材排
         7 秒的镜头，本机执行器遇到这种会直接判失败，这里先自愈，免得白跑一趟。 */
      let plan=null,feedback=null,lastError='';
      /* 用户自己填了口播文案时，模型改不动它：每轮重排后这句覆盖都会把原文按回去，
         重试三次也还是同一个错。这类错误直接把原因抛给用户，别白烧三次模型调用。 */
      const userNarration=input.narration.trim();
      for(let attempt=1;attempt<=3;attempt++){
        if(attempt>1)message('第 '+(attempt-1)+' 次方案不合格（'+lastError+'），正在让模型重排…');
        const raw=await window.WorkbenchEditPlanner(input,text=>{$('jyEditPlanPreview').textContent=text;},feedback);
        if(userNarration)raw.narration=userNarration;
        try{plan=EditPlan.validate(raw,merged,input.target_duration);break;}
        catch(e){
          lastError=e.message;
          if(userNarration&&/口播/.test(e.message))throw Error(e.message+'。这段口播是你在表单里自己填的，模型不会替你改，请手动删减后重试');
          feedback={previous:JSON.stringify(raw),error:e.message};
        }
      }
      if(!plan)throw Error('连续 3 次生成的剪辑方案都不合格：'+lastError);
      if(options.voice==='tts'&&!plan.narration)throw Error('没有提取到口播文案，请填写口播文案');
      $('jyEditPlanPreview').textContent=JSON.stringify(plan,null,2);editFields={edit_plan:plan,edit_options:options};message('剪辑方案已生成，正在提交给剪映 Skill…');
    }
    await post('jobs',{...source,...editFields,mode,model:$('jyModel').value,request_id:requestId,title:$('jyTitle').value,script:$('jyScript').value,captions:$('jyCaptions').value,instructions:$('jyNotes').value,duration:Number($('jyDuration').value),asset_ids:assets.map(a=>a.id),reference_videos:$('jyReferenceVideos').value.split('\n').map(v=>v.trim()).filter(Boolean)});message(mode==='generate'?'生成任务已提交，完成后会显示视频。':'剪辑任务已提交，完成后会显示剪映工程。');await refresh();}
    catch(e){message(e.message,true);}finally{lock(false);}
  };
  const labels={queued:'等待处理',building:'剪辑中',submitting:'提交火山',generating:'AI 生成中',downloading:'取回视频',draft_ready:'工程已生成',finished:'视频已就绪',failed:'制作失败',submission_unknown:'待核对提交'};
  function button(label,fn){const b=document.createElement('button');b.type='button';b.className='btn btn-ghost btn-sm';b.textContent=label;b.onclick=async()=>{b.disabled=true;try{await fn();}catch(e){message(e.message,true);}finally{b.disabled=false;}};return b;}
  async function output(job){if(!outputs.has(job.id)){const blob=await(await api('jobs/'+job.id+'/final')).blob();outputs.set(job.id,URL.createObjectURL(blob));}return outputs.get(job.id);}
  function renderJobs(jobs){
    latestJobs=jobs;
    const tick=jobs.some(j=>['building','queued','submitting','generating','downloading'].includes(j.status))?Math.floor(Date.now()/5000):'';
    const signature=JSON.stringify(jobs.map(({lease_until,...job})=>job))+tick;if(signature===jobsSignature)return;jobsSignature=signature;
    const focused=document.activeElement,focusedCard=focused?.closest('.jy-job');
    const focusIndex=focusedCard?[...focusedCard.querySelectorAll('button,input,summary,a')].indexOf(focused):-1;
    const previous=new Map([...$('jyJobs').querySelectorAll('.jy-job')].map(card=>[card.dataset.jobId,card]));
    const cards=[];
    $('badgeVideo').textContent=jobs.length;$('badgeVideo').dataset.zero=jobs.length?'0':'1';
    if(!jobs.length){const empty=document.createElement('div');empty.className='empty';empty.textContent='还没有制作任务。提交后会在这里显示进度和结果。';$('jyJobs').replaceChildren(empty);filterJobs();return;}
    for(const job of [...jobs].reverse()){
      const oldCard=previous.get(String(job.id)),cardSignature=JSON.stringify(job)+(['building','queued','submitting','generating','downloading'].includes(job.status)?tick:'');
      if(oldCard?.dataset.signature===cardSignature){cards.push(oldCard);continue;}
      const opened=new Set(oldCard?[...oldCard.querySelectorAll('details[open]')].map(d=>d.dataset.section):[]);
      const card=document.createElement('article');card.className='jy-job';card.dataset.jobId=job.id;card.dataset.signature=cardSignature;card.dataset.jobStatus=job.status;card.tabIndex=-1;const head=document.createElement('div');head.className='video-job-head';const info=document.createElement('div'),title=document.createElement('h4');title.textContent=job.title;info.append(title);
      const summary=document.createElement('p');summary.className='video-job-meta';summary.textContent=(job.mode==='generate'?'AI 生成':'剪映剪辑')+' · '+job.duration+' 秒 · '+(job.assets.length+(job.reference_videos || []).length)+' 个素材'+(job.script_id?' · 关联拍摄脚本':'');info.append(summary);head.append(info);
      const status=document.createElement('span');status.className='video-job-status'+(['failed','submission_unknown'].includes(job.status)?' is-failed':['finished','draft_ready'].includes(job.status)?' is-done':'');status.textContent=labels[job.status] || job.status;head.append(status);card.append(head);
      const next=document.createElement('p');next.className='production-next-step';next.textContent=ProductionWorkflow.nextStep(job);card.append(next);
      if(job.mode!=='generate'&&job.edit_plan){const stage=document.createElement('p');stage.className='video-job-meta';stage.textContent=(job.edit_stage||'等待剪映执行器')+(job.updated_at?' · 更新于 '+new Date(job.updated_at).toLocaleTimeString():'');card.append(stage);
        const warns=(job.edit_report&&job.edit_report.warnings)||[];
        if(warns.length){const w=document.createElement('p');w.className='hint';w.textContent='已丢弃 '+warns.length+' 项无效视觉设置：'+warns.slice(0,3).join('；')+(warns.length>3?' 等':'')+'。工程照常生成，细节见下方执行结果。';card.append(w);}
        const details=document.createElement('details'),summary=document.createElement('summary'),pre=document.createElement('pre');details.dataset.section='edit';details.open=opened.has('edit');summary.textContent='剪辑方案与执行结果';pre.className='video-prompt';pre.textContent=JSON.stringify({plan:job.edit_plan,options:job.edit_options,report:job.edit_report},null,2);details.append(summary,pre);card.append(details);}
      if(job.mode==='generate'){
        const active=['queued','submitting','generating','downloading'].includes(job.status);
        const progress=document.createElement('div');progress.className='video-progress';
        const stages=['等待提交','火山生成','取回文件','可预览'];
        const step=job.status==='finished'?3:job.status==='downloading'?2:job.remote_id?1:0;
        const list=document.createElement('ol');list.setAttribute('aria-label','制作阶段');
        stages.forEach((label,i)=>{const li=document.createElement('li');li.textContent=label;li.className=i<step?'is-complete':i===step&&(active||job.status==='finished')?'is-current':'';if(i===step&&(active||job.status==='finished'))li.setAttribute('aria-current','step');list.append(li);});progress.append(list);
        const detail=document.createElement('p');detail.className='video-progress-detail';
        const seconds=Math.max(0,Math.floor((Date.parse(job.finished_at || new Date().toISOString())-Date.parse(job.created_at))/1000));
        const elapsed=seconds<60?seconds+'秒':Math.floor(seconds/60)+'分'+seconds%60+'秒';
        const remote={queued:'火山排队中',running:'火山正在生成画面与声音',succeeded:'火山生成成功',failed:'火山生成失败',expired:'火山任务已过期',cancelled:'任务已取消'};
        detail.textContent=(remote[job.remote_status] || labels[job.status])+' · '+(active?'已等待 '+elapsed:job.finished_at?'总耗时 '+elapsed:'创建于 '+new Date(job.created_at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}))+(job.last_checked_at?' · 最近查询 '+new Date(job.last_checked_at).toLocaleTimeString('zh-CN',{hour12:false}):'');
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
      if(job.status==='failed'){const isEdit=job.mode!=='generate';actions.append(button(job.remote_id&&!job.remote_failed?'继续查询 / 下载':isEdit?'重新生成方案并重试':'用当前模型重试',async()=>{
        if(!isEdit){await post('jobs/'+job.id+'/retry',{model:$('jyModel').value});await refresh();return;}
        /* 剪辑失败不能直接 retry：那只把旧方案重新排队。还原输入、重出一版方案再提交。 */
        restoreEditJob(job);message('已还原这条任务的输入，正在重新生成剪辑方案…');$('jyForm').requestSubmit();
      }));}
      if(job.status==='submission_unknown'){
        const form=document.createElement('div');form.className='video-reconcile';const input=document.createElement('input');input.placeholder='控制台中的 cgt- 任务 ID';input.setAttribute('aria-label','火山任务 ID');input.value=oldCard?.querySelector('.video-reconcile input')?.value||'';form.append(input,button('继续查询',async()=>{await post('jobs/'+job.id+'/reconcile',{remote_id:input.value.trim()});await refresh();}));card.append(form);
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
    $('jyJobs').replaceChildren(...cards);filterJobs();
    if(focusedCard){const card=cards.find(card=>card.dataset.jobId===focusedCard.dataset.jobId);if(!card||card.hidden){[...$('jyJobFilters').children].find(el=>el.dataset.jobFilter===jobFilter)?.focus({preventScroll:true});}else if(!card.contains(document.activeElement)){(card.dataset.jobStatus===focusedCard.dataset.jobStatus&&focusIndex>=0?card.querySelectorAll('button,input,summary,a')[focusIndex]:card)?.focus({preventScroll:true});}}
  }
  async function refresh(){if(!token||refreshing)return;refreshing=true;try{const [status,jobs]=await Promise.all([api('status').then(r=>r.json()),api('jobs').then(r=>r.json())]);device=status;serviceReady=true;connection();renderJobs(jobs);$('jyPollingStatus').textContent='每5秒自动刷新 · 页面最近更新 '+new Date().toLocaleTimeString('zh-CN',{hour12:false});$('jyPollingStatus').style.color='';}catch(error){serviceReady=false;connection();throw error;}finally{refreshing=false;}}
  $('jyJobSearch').addEventListener('input',event=>{jobQuery=event.target.value;filterJobs();});
  $('jyJobFilters').addEventListener('click',event=>{const b=event.target.closest('[data-job-filter]');if(!b)return;jobFilter=b.dataset.jobFilter;filterJobs();[...$('jyJobFilters').children].find(el=>el.dataset.jobFilter===jobFilter)?.focus({preventScroll:true});});
  $('jyJobClear').onclick=()=>{jobFilter='all';jobQuery='';$('jyJobSearch').value='';filterJobs();$('jyJobSearch').focus();};
  filterJobs();
  $('jyModeEdit').onclick=()=>setMode('edit');$('jyModeGenerate').onclick=()=>setMode('generate');$('jyConnect').onclick=connect;$('jyRefresh').onclick=()=>refresh().catch(e=>message(e.message,true));
  /* 换电脑时复制本机制作服务的启动脚本 */
  const startCopy=$('jyStartCopy');
  if(startCopy)startCopy.onclick=async()=>{
    const code=($('jyStartCode')?.textContent || '').replace(/\s+$/,'')+'\n';
    try{await navigator.clipboard.writeText(code);startCopy.textContent='已复制 ✓';}
    catch(e){const r=document.createRange();r.selectNodeContents($('jyStartCode'));const sel=window.getSelection();sel.removeAllRanges();sel.addRange(r);startCopy.textContent='已选中 · 按 ⌘C 复制';}
    setTimeout(()=>{startCopy.textContent='复制启动脚本';},1800);
  };
  setInterval(()=>{if($('view-video').classList.contains('is-active'))refresh().catch(()=>{serviceReady=false;renderPreparation();$('jyPollingStatus').textContent='状态刷新失败，请检查本机服务或点击重新连接。';$('jyPollingStatus').style.color='var(--danger)';});},5000);
  window.addEventListener('beforeunload',()=>{for(const url of [...thumbs.values(),...outputs.values()])URL.revokeObjectURL(url);});
  /* 供「密钥」弹窗保存火山密钥后立即重新探测连接状态 */
  window.JianyingStudio={reconnect:()=>connect(),refreshStatus:()=>{if(!token)return;api('generation/status').then(r=>r.json()).then(d=>{generation=d;connection();}).catch(()=>{});}};
  setMode('edit');
  connect();
})();
