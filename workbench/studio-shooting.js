/* Browser-local shooting checklist; the script and production state stay untouched. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const dialog=$('shootDialog');
  const fallback=new Map();
  let session=null,returnFocus=null,returnScope=null;
  const storageKey=(namespace,id)=>'wj_shooting_v1:'+encodeURIComponent(namespace)+':'+encodeURIComponent(id);
  const focusable=()=>[...dialog.querySelectorAll('button, [tabindex]')].filter(el=>!el.disabled && el.tabIndex>=0 && el.getClientRects().length);
  function storageNote(){
    $('shootStorage').textContent=session.temporary?'浏览器暂时无法保存，进度仅在本次页面打开期间保留。':'拍摄进度仅保存在当前浏览器，不会更改发布或制作状态。';
  }
  function save(){
    if(!session)return;
    try{
      localStorage.setItem(session.key,JSON.stringify(session.state));
      fallback.delete(session.key);session.temporary=false;
    }catch(_){fallback.set(session.key,structuredClone(session.state));session.temporary=true;}
    storageNote();
  }
  function render(direction=0){
    const {plan,state}=session;
    const scrollTop=$('shootBody').scrollTop;
    const shot=plan.steps[state.index];
    const unit=plan.mode==='shots'?'镜':'段';
    $('shootPosition').textContent=String(state.index+1).padStart(2,'0')+' / '+String(plan.steps.length).padStart(2,'0');
    $('shootHeading').textContent=shot.title;
    $('shootTime').textContent=shot.time;
    $('shootTime').hidden=!shot.time;
    const fields=$('shootFields');fields.replaceChildren();
    for(const field of shot.fields){
      if(shot.time && /时间|时长/.test(field.label) && field.text===shot.time)continue;
      const section=document.createElement('section');
      const label=document.createElement('h4');label.textContent=field.label;
      const text=document.createElement('p');text.textContent=field.text || '原脚本未填写';
      section.append(label,text);fields.appendChild(section);
    }
    $('shootBody').dataset.size=state.size;
    $('shootBody').scrollTop=direction?0:scrollTop;
    $('shootProgress').max=plan.steps.length;$('shootProgress').value=state.done.length;
    $('shootCount').textContent=(plan.mode==='shots'?'已拍 ':'已完成 ')+state.done.length+' / '+plan.steps.length;
    const done=state.done.includes(state.index);
    $('shootMark').setAttribute('aria-pressed',String(done));
    $('shootMark').textContent=done?'✓ 已标记 · 点击撤销':plan.mode==='shots'?'标记这一镜已拍':'标记这一段完成';
    $('shootPrev').disabled=state.index===0;
    $('shootNext').disabled=state.index===plan.steps.length-1;
    $('shootPrev').textContent='← 上一'+unit;$('shootNext').textContent='下一'+unit+' →';
    $('shootComplete').hidden=state.done.length!==plan.steps.length;
    $('shootComplete').textContent='这份清单已全部标记，可以返回任意'+unit+'检查或撤销。';
    for(const button of $('shootSteps').children){
      const index=Number(button.dataset.shotIndex),checked=state.done.includes(index);
      button.classList.toggle('is-current',index===state.index);
      button.classList.toggle('is-done',checked);
      if(index===state.index)button.setAttribute('aria-current','step');else button.removeAttribute('aria-current');
      button.querySelector('.shoot-step-state').textContent=checked?'✓':'○';
      button.setAttribute('aria-label','第 '+(index+1)+' '+unit+(checked?'，已标记':'，未标记'));
    }
    for(const button of dialog.querySelectorAll('[data-shoot-size]'))button.setAttribute('aria-pressed',String(button.dataset.shootSize===state.size));
    $('shootAnnounce').textContent='第 '+(state.index+1)+' '+unit+'，共 '+plan.steps.length+' '+unit+(done?'，已标记':'，未标记');
    if(direction)window.StudioMotion?.region($('shootBody'),direction);
  }
  function navigate(index){
    if(!session)return;
    const next=Math.max(0,Math.min(session.plan.steps.length-1,index));
    if(next===session.state.index)return;
    const direction=Math.sign(next-session.state.index);
    session.state.index=next;save();render(direction);
    if(document.activeElement?.disabled)$('shootMark').focus({preventScroll:true});
    const active=$('shootSteps').querySelector('[aria-current="step"]');
    if(active)active.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
  }
  function open(script,namespace){
    const source=String(script.content || '');
    const plan=ShootingPlan.parse(source);
    if(!plan.steps.length)return false;
    const key=storageKey(namespace,script.id);let saved=null,temporary=false;
    try{saved=JSON.parse(localStorage.getItem(key));}catch(_){temporary=true;}
    if(fallback.has(key)){saved=fallback.get(key);temporary=true;}
    const restored=ShootingPlan.restore(source,plan.steps.length,saved);
    session={id:script.id,key,plan,state:restored.state,temporary};
    returnFocus=document.activeElement;
    returnScope=returnFocus.closest('#modal, #scriptList')?.id;
    $('shootTitle').textContent=script.title || '拍摄脚本';
    $('shootAccount').textContent=script.account || '拍摄清单';
    $('shootFormat').textContent=plan.mode==='shots'?'按原脚本分镜表逐镜阅读':'未识别出完整分镜表，以下按原文分段阅读。';
    $('shootChanged').hidden=!restored.changed;
    $('shootChanged').textContent='脚本内容已更新，旧的拍摄标记已重置，从第一'+(plan.mode==='shots'?'镜':'段')+'开始。';
    const steps=$('shootSteps');steps.replaceChildren();
    plan.steps.forEach((shot,index)=>{
      const button=document.createElement('button');button.type='button';button.dataset.shotIndex=String(index);
      const number=document.createElement('b');number.textContent=String(index+1).padStart(2,'0');
      const title=document.createElement('span');title.textContent=shot.time || shot.title;
      const status=document.createElement('span');status.className='shoot-step-state';status.setAttribute('aria-hidden','true');
      button.append(number,title,status);steps.appendChild(button);
    });
    dialog.hidden=false;dialog.showModal();document.body.classList.add('shooting-open');
    $('shootBody').scrollTop=0;save();render();$('shootTitle').focus({preventScroll:true});
    window.StudioMotion?.dialog(dialog,true);
    return true;
  }
  function close(){
    if(!dialog.open)return;
    save();window.StudioMotion?.dialog(dialog,false);dialog.close();dialog.hidden=true;
    document.body.classList.remove('shooting-open');
    const scope=$(returnScope);
    const replacement=scope && [...scope.querySelectorAll('[data-shoot-script], #modalShoot')].find(el=>el.id==='modalShoot' || el.dataset.shootScript===String(session.id));
    const target=returnFocus?.isConnected && returnFocus.getClientRects().length?returnFocus:replacement || $('views');
    target.focus({preventScroll:true});session=null;returnFocus=null;returnScope=null;
  }
  $('shootClose').addEventListener('click',close);
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  $('shootPrev').addEventListener('click',()=>navigate(session.state.index-1));
  $('shootNext').addEventListener('click',()=>navigate(session.state.index+1));
  $('shootMark').addEventListener('click',()=>{
    const {state}=session;
    state.done=state.done.includes(state.index)?state.done.filter(index=>index!==state.index):[...state.done,state.index];
    save();render();
  });
  $('shootSteps').addEventListener('click',event=>{const button=event.target.closest('[data-shot-index]');if(button)navigate(Number(button.dataset.shotIndex));});
  dialog.addEventListener('click',event=>{
    const button=event.target.closest('[data-shoot-size]');if(!button)return;
    session.state.size=button.dataset.shootSize;save();
    $('shootBody').dataset.size=session.state.size;
    for(const item of dialog.querySelectorAll('[data-shoot-size]'))item.setAttribute('aria-pressed',String(item===button));
  });
  dialog.addEventListener('keydown',event=>{
    // Escape belongs to this topmost dialog, not a confirmation in the underlying reader.
    if(event.key==='Escape')event.stopPropagation();
    if(event.key==='Tab'){
      const controls=focusable(),first=controls[0],last=controls[controls.length-1];
      if(event.shiftKey && (document.activeElement===first || !controls.includes(document.activeElement))){event.preventDefault();last?.focus();}
      else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first?.focus();}
    }
    if(!event.altKey && !event.ctrlKey && !event.metaKey && (event.key==='ArrowLeft' || event.key==='ArrowRight')){
      event.preventDefault();navigate(session.state.index+(event.key==='ArrowRight'?1:-1));
    }
  });
  window.StudioShooting={open};
})();
