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
  let tiltFrame = 0;
  let tiltPoint = null;
  try { preference = localStorage.getItem(storageKey) !== 'off'; } catch (_) {}

  const enabled = () => preference && !reduce.matches && !document.hidden;
  const visible = element => element && element.isConnected && element.getClientRects().length > 0;

  function stop(scope) {
    for (const [animation, owner] of effects) {
      if (!scope || owner === scope) {
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
          ? '.stage-intro, .creative-network, .summary-item, .home-bottom-grid > .panel'
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

  function resetTilt() {
    cancelAnimationFrame(tiltFrame);
    tiltFrame = 0;
    tiltPoint = null;
    core?.style.removeProperty('--core-rx');
    core?.style.removeProperty('--core-ry');
  }

  function highlight() {
    const focused = network?.contains(document.activeElement)
      ? document.activeElement.closest('[data-route]')?.dataset.route : '';
    const route = activeView === 'home' ? focused || hoveredRoute : '';
    network?.querySelectorAll('[data-network-route]').forEach(path => {
      path.classList.toggle('is-linked', path.dataset.networkRoute === route);
    });
    network?.querySelectorAll('.network-node').forEach(node => {
      node.classList.toggle('is-linked', node.dataset.route === route);
    });
    core?.classList.toggle('is-linked', !!route);
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
    hoveredRoute = event.target.closest('.network-node')?.dataset.route || '';
    highlight();
  });
  network?.addEventListener('pointerleave', () => { hoveredRoute = ''; resetTilt(); highlight(); });
  network?.addEventListener('focusin', highlight);
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

  window.StudioMotion = {enter, refresh, enabled};
  sync();
  refresh('home', true);
})();
