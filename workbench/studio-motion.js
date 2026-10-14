/* Presentation only. Cancelling any animation reveals the real, final UI state. */
(() => {
  'use strict';
  const body = document.body;
  const toggle = document.getElementById('motionToggle');
  const label = document.getElementById('motionToggleLabel');
  const network = document.querySelector('.creative-network');
  const core = document.querySelector('.creative-core');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const pointer = matchMedia('(hover: hover) and (pointer: fine)');
  const storageKey = 'wj_studio_motion';
  const effects = new Map();
  const frames = new Map();
  let preference = true;
  let activeView = 'home';
  let hoveredRoute = '';
  let inputMode = 'keyboard';
  let linkedRoute = '';
  let tiltFrame = 0;
  let tiltPoint = null;
  try { preference = localStorage.getItem(storageKey) !== 'off'; } catch (_) {}

  const enabled = () => preference && !reduce.matches && !document.hidden;
  const visible = element => element && element.isConnected && element.getClientRects().length > 0;

  function stop(scope) {
    for (const [animation, owner] of effects) {
      if (!scope || owner === scope || scope.contains(owner)) {
        animation.cancel();
        effects.delete(animation);
      }
    }
  }

  function play(element, keyframes, options, scope) {
    if (!enabled() || !visible(element) || !element.animate) return;
    const animation = element.animate(keyframes, {duration:420, easing:'cubic-bezier(.2,.75,.25,1)', ...options});
    effects.set(animation, scope);
    const release = () => effects.delete(animation);
    animation.onfinish = release;
    animation.oncancel = release;
  }

  function reveal(elements, scope) {
    [...elements].slice(0,12).forEach((element,index) => {
      play(element, [{opacity:0, transform:'translateY(10px)'}, {opacity:1, transform:'translateY(0)'}],
        {delay:Math.min(index * 38,228), fill:'backwards'}, scope);
    });
  }

  function charts(root) {
    root.querySelectorAll('.chart-bar').forEach((bar,index) => {
      play(bar, [{transform:'scaleY(.04)'}, {transform:'scaleY(1)'}],
        {duration:620, delay:index * 42, fill:'backwards'}, root);
    });
    const ring = root.querySelector('.ring-value');
    if (ring && ring.style.opacity !== '0') {
      const length = parseFloat(ring.getAttribute('stroke-dasharray')) || 0;
      play(ring, [{strokeDashoffset:String(length)}, {strokeDashoffset:'0'}], {duration:800}, root);
    }
  }

  function refresh(view, entrance = false) {
    if (frames.has(view)) cancelAnimationFrame(frames.get(view));
    const frame = requestAnimationFrame(() => {
      frames.delete(view);
      if (!enabled() || activeView !== view) return;
      const root = document.getElementById('view-' + view);
      if (!visible(root)) return;
      stop(root);
      if (view === 'home') {
        reveal(root.querySelectorAll(entrance
          ? '.stage-intro, .creative-network, .summary-item, .home-calendar, .home-bottom-grid > .panel'
          : '.summary-item, .next-item'), root);
      } else if (view === 'materials') {
        reveal(root.querySelectorAll('#materialGrid > .card'), root);
      } else if (view === 'data') {
        reveal(root.querySelectorAll('#dataKpis > .kpi'), root);
        charts(root);
      } else if (entrance) {
        reveal(root.querySelectorAll(':scope > .panel, :scope > .split, :scope > .kpis, :scope > form, :scope > .two-col'), root);
      }
      if (entrance) play(root.querySelector('.studio-page-heading'), [{opacity:0},{opacity:1}], {duration:250}, root);
    });
    frames.set(view, frame);
  }

  // Local updates own their animations so rapid input cannot queue stale transitions.
  function region(element, direction = 0) {
    stop(element);
    if (!element?.closest('.view.is-active, dialog[open]')) return;
    const transform = direction ? 'translateX('+Math.sign(direction)*14+'px)' : 'translateY(6px)';
    play(element, [{opacity:.55,transform},{opacity:1,transform:'translate(0)'}],
      {duration:220}, element);
  }

  function snapshot(list, attribute = 'data-script-id') {
    stop(list);
    if (!enabled() || !list.closest('.view.is-active')) return null;
    return new Map([...list.querySelectorAll('['+attribute+']')].slice(0,12).map(card => {
      const rect=card.getBoundingClientRect();
      return [card.getAttribute(attribute),{x:rect.left,y:rect.top}];
    }));
  }

  function settle(list, previous, attribute = 'data-script-id') {
    stop(list);
    if (!previous || !list.closest('.view.is-active')) return;
    [...list.querySelectorAll('['+attribute+']')].slice(0,12).forEach(card => {
      const old = previous.get(card.getAttribute(attribute));
      const rect = card.getBoundingClientRect();
      const clamp = value=>Math.max(-72,Math.min(72,value));
      const x = old ? clamp(old.x-rect.left) : 0;
      const y = old ? clamp(old.y-rect.top) : 8;
      if (old && Math.abs(x)<1 && Math.abs(y)<1) return;
      play(card, [{opacity:old ? 1 : .4,transform:'translate('+x+'px,'+y+'px)'},
        {opacity:1,transform:'translate(0)'}], {duration:240}, list);
    });
  }

  function selection(card, counter) {
    if (!counter.closest('.view.is-active')) return;
    if(card){
      stop(card);
      play(card,[{scale:'.992'},{scale:'1'}],{duration:200},card);
    }
    stop(counter);
    play(counter,[{scale:'1'},{scale:'1.16',offset:.4},{scale:'1'}],{duration:260},counter);
  }

  function dialog(element, opening) {
    stop(element);
    if (!opening) return;
    play(element.querySelector('.modal-bg'), [{opacity:0},{opacity:1}], {duration:180}, element);
    play(element.querySelector('.modal-card'),
      [{opacity:0,transform:'translateY(14px) scale(.985)'},{opacity:1,transform:'translateY(0) scale(1)'}],
      {duration:260}, element);
  }

  function resetTilt() {
    cancelAnimationFrame(tiltFrame);
    tiltFrame = 0;
    tiltPoint = null;
    core?.style.removeProperty('--core-rx');
    core?.style.removeProperty('--core-ry');
  }

  const moduleLabels = {
    materials:['风口选题','DISCOVER'], scripts:['拍摄辅助','CREATE'],
    video:['视频制作','PRODUCE'], schedule:['发布日历','PUBLISH']
  };

  function aim(route) {
    const node = network?.querySelector('.network-node[data-route="'+route+'"] .node-orb');
    const center = core?.getBoundingClientRect();
    if (!node || !center?.width) return;
    const target = node.getBoundingClientRect();
    const dx = target.left+target.width/2-center.left-center.width/2;
    const dy = target.top+target.height/2-center.top-center.height/2;
    const length = Math.hypot(dx,dy) || 1;
    // Move a soft pool of light toward the node; the frame never rotates.
    core.style.setProperty('--glow-x',(dx/length*center.width*.32).toFixed(2)+'px');
    core.style.setProperty('--glow-y',(dy/length*center.height*.32).toFixed(2)+'px');
    core.style.setProperty('--orb-x',(dx/length*4).toFixed(2)+'px');
    core.style.setProperty('--orb-y',(dy/length*4).toFixed(2)+'px');
    core.style.setProperty('--light-x',(dx/length*19).toFixed(2)+'px');
    core.style.setProperty('--light-y',(dy/length*19).toFixed(2)+'px');
  }

  function highlight() {
    const focused = network?.contains(document.activeElement)
      ? document.activeElement.closest('.network-node[data-route]')?.dataset.route : '';
    const intended = inputMode==='pointer' ? hoveredRoute || focused : focused || hoveredRoute;
    const route = activeView === 'home' ? intended || '' : '';
    network?.querySelectorAll('[data-network-route]').forEach(path => {
      path.classList.toggle('is-linked', path.dataset.networkRoute === route);
    });
    network?.querySelectorAll('.network-node').forEach(node => {
      node.classList.toggle('is-linked', node.dataset.route === route);
    });
    core?.classList.toggle('is-linked', !!route);
    if(core)core.dataset.module=route;
    if(route)aim(route);
    else if(core){
      for(const property of ['--glow-x','--glow-y','--orb-x','--orb-y','--light-x','--light-y'])core.style.removeProperty(property);
    }
    if(route!==linkedRoute){
      linkedRoute=route;
      // One response per selection, cancelled when selection changes rapidly.
      if(core){
        stop(core);
        if(route){
          play(core.querySelector('.core-response'),
            [{opacity:0,transform:'scale(.72)'},{opacity:.65,offset:.25},{opacity:0,transform:'scale(1.1)'}],
            {duration:1150},core);
          play(core.querySelector('.orb-center'),
            [{transform:'scale(1)'},{transform:'scale(1.09)',offset:.35},{transform:'scale(1)'}],
            {duration:850},core);
        }
      }
      const title=document.getElementById('coreModuleLabel');
      const subtitle=document.getElementById('coreModuleSub');
      if(title)title.textContent=moduleLabels[route]?.[0] || '灵感，在这里生长';
      if(subtitle)subtitle.textContent=moduleLabels[route]?.[1] || 'CONTENT STUDIO';
    }
  }

  function sync() {
    body.classList.add('motion-ready');
    body.dataset.motion = enabled() ? 'on' : 'off';
    body.dataset.activeView = activeView;
    toggle.hidden = false;
    toggle.disabled = reduce.matches;
    toggle.setAttribute('aria-pressed', String(preference && !reduce.matches));
    label.textContent = reduce.matches ? '系统已减弱动效' : preference ? '动效开启' : '动效关闭';
    toggle.title = reduce.matches ? '遵循系统的减少动态效果设置' : preference ? '关闭界面动效，保留操作反馈' : '开启界面动效';
    if (!enabled()) {
      stop();
      frames.forEach(frame => cancelAnimationFrame(frame));
      frames.clear();
      resetTilt();
    }
  }

  function enter(view) {
    stop();
    frames.forEach(frame => cancelAnimationFrame(frame));
    frames.clear();
    activeView = view;
    hoveredRoute = '';
    resetTilt();
    highlight();
    sync();
    refresh(view, true);
  }

  toggle.addEventListener('click', () => {
    preference = !preference;
    try { localStorage.setItem(storageKey, preference ? 'on' : 'off'); } catch (_) {}
    sync();
  });
  reduce.addEventListener('change', sync);
  document.addEventListener('visibilitychange', sync);
  pointer.addEventListener('change', resetTilt);
  window.addEventListener('storage', event => {
    if (event.key === storageKey || event.key === null) {
      preference = event.newValue !== 'off';
      sync();
    }
  });

  network?.addEventListener('pointerover', event => {
    if (event.pointerType !== 'mouse') return;
    const route = event.target.closest('.network-node')?.dataset.route;
    if(!route)return;
    inputMode='pointer';hoveredRoute=route;highlight();
  });
  network?.addEventListener('pointerleave', () => { hoveredRoute = ''; resetTilt(); highlight(); });
  network?.addEventListener('focusin', event => {
    if(event.target.matches(':focus-visible'))inputMode='keyboard';
    highlight();
  });
  network?.addEventListener('keydown', event => {
    if(event.key==='Tab'){inputMode='keyboard';highlight();}
  });
  if(network && typeof ResizeObserver==='function')new ResizeObserver(()=>{if(linkedRoute && activeView==='home')aim(linkedRoute)}).observe(network);
  network?.addEventListener('focusout', () => queueMicrotask(highlight));
  network?.addEventListener('pointermove', event => {
    if (!enabled() || activeView !== 'home' || !pointer.matches || event.pointerType !== 'mouse') return;
    const box = network.getBoundingClientRect();
    tiltPoint = {x:((event.clientX-box.left)/box.width-.5)*8, y:((event.clientY-box.top)/box.height-.5)*-8};
    if (!tiltFrame) tiltFrame = requestAnimationFrame(() => {
      tiltFrame = 0;
      if (!tiltPoint || !enabled()) return;
      core.style.setProperty('--core-rx', tiltPoint.y.toFixed(2)+'deg');
      core.style.setProperty('--core-ry', tiltPoint.x.toFixed(2)+'deg');
    });
  }, {passive:true});

  window.StudioMotion = {enter, refresh, enabled, region, snapshot, settle, selection, dialog};
  sync();
  refresh('home', true);
})();
