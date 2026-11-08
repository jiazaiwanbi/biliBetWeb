// ==UserScript==
// @name         哔哩哔哩直播 · 预言（官方 H5 版）
// @namespace    local.bilibili.live.prophecy.official
// @version      1.0.0
// @description  在电脑直播间嵌入官方手机预言页面，保留拖动、倒计时和全屏显隐。
// @homepageURL  https://github.com/jiazaiwanbi/biliBetWeb
// @downloadURL  https://raw.githubusercontent.com/jiazaiwanbi/biliBetWeb/main/bilibili-live-prophecy-official.user.js
// @updateURL    https://raw.githubusercontent.com/jiazaiwanbi/biliBetWeb/main/bilibili-live-prophecy-official.user.js
// @match        https://live.bilibili.com/*
// @exclude      https://live.bilibili.com/p/*
// @connect      api.live.bilibili.com
// @connect      api.bilibili.com
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// @noframes
// @license      MIT
// ==/UserScript==

/* The iframe loads Bilibili's hosted page without copying or rewriting its code.
 * This wrapper only reads room/login/status APIs. All participation, confirmation,
 * history, and settlement UI belong to the official page. No cookie is exported.
 */
(function () {
  'use strict';
  const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const secondsLeft = (p, now) => Math.max(0, Math.ceil((num(p.count_down_time) * 1000 - now) / 1000));
  const formatTime = s => `${String(Math.floor(Math.max(0, s) / 60)).padStart(2, '0')}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;
  function statusOf(item, now) {
    const p = item.prophet || {};
    switch (num(p.prophet_status)) {
      case 0: return { label: '未开始', kind: 'idle' };
      case 1: return secondsLeft(p, now) > 0
        ? { label: '进行中', kind: 'active' } : { label: '未公布', kind: 'pending' };
      case 2: return { label: '未公布', kind: 'pending' };
      case 3: return { label: '已公布', kind: 'settled' };
      case 4: return { label: '已取消', kind: 'cancelled' };
      default: return { label: '状态未知', kind: 'idle' };
    }
  }

  function summaryOf(items, now) {
    const active = items.filter(x => statusOf(x, now).kind === 'active');
    if (active.length) return { label: formatTime(Math.min(...active.map(x => secondsLeft(x.prophet, now)))), kind: 'active', count: active.length };
    for (const kind of ['pending', 'idle', 'settled', 'cancelled']) {
      const found = items.find(x => statusOf(x, now).kind === kind);
      if (found) return { ...statusOf(found, now), count: 0 };
    }
    return { label: '暂无预言', kind: 'empty', count: 0 };
  }

  function isFullscreenView(nativeFullscreen, rect, width, height) {
    // Bilibili's webpage fullscreen also fills the viewport, without the Fullscreen API.
    return !!nativeFullscreen || !!rect && width > 0 && height > 0
      && Math.abs(rect.left) <= 2 && Math.abs(rect.top) <= 2
      && rect.width >= width - 2 && rect.height >= height - 2;
  }


  function buildOfficialUrl(anchorId, roomId) {
    if (![anchorId, roomId].every(id => /^[1-9]\d*$/.test(String(id)))) throw new Error('直播间参数无效');
    const url = new URL('https://live.bilibili.com/p/html/live-app-guessing-game/index.html');
    url.search = new URLSearchParams({ anchorId: String(anchorId), roomId: String(roomId) });
    return url.href;
  }
  if (typeof module === 'object' && module.exports) {
    module.exports = { secondsLeft, formatTime, statusOf, summaryOf, isFullscreenView, buildOfficialUrl };
    return;
  }
  const currentRoom = () => location.pathname.match(/^\/(\d+)(?:\/|$)/)?.[1] || '';
  if (window.top !== window.self || !currentRoom() || document.getElementById('bili-prophecy-official')) return;
  if (typeof GM_xmlhttpRequest !== 'function') return;
  const API = 'https://api.live.bilibili.com';
  const STAR = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="m16 3 3.9 8 8.8 1.3-6.4 6.2 1.5 8.8-7.8-4.1-7.8 4.1 1.5-8.8-6.4-6.2 8.8-1.3Z" fill="currentColor"/></svg>';
  const readSetting = (key, fallback) => { try { return GM_getValue(key, fallback); } catch { return fallback; } };
  const saveSetting = (key, value) => { try { GM_setValue(key, value); } catch { /* Optional preference. */ } };
  const host = document.createElement('div');
  host.id = 'bili-prophecy-official';
  host.style.cssText = 'position:fixed;inset:0 auto auto 0;width:0;height:0;z-index:2147483646;color-scheme:dark;';
  document.body.append(host);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
    :host{all:initial;color-scheme:dark}*{box-sizing:border-box}
    .app{font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;color:#efedf5}
    button{font:inherit;color:inherit;border:0;cursor:pointer}button:focus-visible,a:focus-visible{outline:2px solid #b7a1ff;outline-offset:3px}
    .launcher{position:fixed;width:48px;height:48px;padding:0;display:block;border:1px solid #ffffff24;border-radius:13px;background:linear-gradient(150deg,#7460c980,#29243866);box-shadow:0 4px 15px #0004;touch-action:none;user-select:none;backdrop-filter:blur(6px)}
    .launcher{transition:opacity .15s ease,visibility .15s ease}.launcher[data-controls-hidden=true]{opacity:0;visibility:hidden;pointer-events:none}.launcher:hover{filter:brightness(1.12)}.star-wrap{position:absolute;top:3px;left:50%;transform:translateX(-50%);width:34px;height:34px;display:grid;place-items:center}.star-wrap svg{width:34px;height:34px;color:#e1d6ff;filter:drop-shadow(0 1px 3px #22173966)}.live-dot{display:none;position:absolute;right:1px;top:1px;width:7px;height:7px;border:1px solid #64518c99;border-radius:50%;background:#66edc1}.launcher[data-kind=active] .live-dot{display:block}.launcher-label{position:absolute;z-index:1;bottom:3px;left:50%;transform:translateX(-50%);max-width:44px;padding:0 3px;border:1px solid #ffffff12;border-radius:5px;background:#1b1628a8;color:#e6dcfa;font-size:9px;line-height:13px;white-space:nowrap;font-weight:650;font-variant-numeric:tabular-nums}.launcher[data-kind=active] .launcher-label{color:#9ff4d4;font-size:10px}

    .panel{position:fixed;width:min(424px,calc(100vw - 24px));height:min(708px,calc(100dvh - 32px));border:1px solid #ffffff22;border-radius:16px;background:#18161e;box-shadow:0 18px 70px #0008}.panel[hidden]{display:none}
    .frame-wrap{height:100%;overflow:hidden;border-radius:inherit}.official-frame{display:block;width:100%;height:100%;border:0;background:#18161e;color-scheme:normal}
    .close{position:absolute;z-index:3;right:-9px;top:-10px;width:28px;height:28px;border:1px solid #ffffff30;border-radius:50%;background:#292433;color:#ded7e7;box-shadow:0 2px 8px #0005;font-size:20px;line-height:24px}.close:hover{background:#43384e}
    .notice{position:absolute;z-index:2;left:12px;right:12px;top:45%;padding:14px;border-radius:10px;background:#282331ed;color:#d9cde5;font-size:12px;text-align:center}.notice:empty{display:none}.notice a{display:inline-block;margin-top:9px;color:#cbb0ff}.notice p{margin:0}
    @media(prefers-reduced-motion:reduce){*{transition:none!important}}
  </style><div class="app">
    <button class="launcher" aria-label="打开官方直播预言" aria-expanded="false" data-kind="idle"><span class="star-wrap">${STAR}<i class="live-dot"></i></span><span class="launcher-label">加载中</span></button>
    <section class="panel" role="dialog" aria-label="官方直播预言" hidden>
      <button class="close" aria-label="关闭预言" title="关闭">×</button><div class="frame-wrap"></div><div class="notice" role="status"></div>
    </section></div>`;
  const $ = selector => root.querySelector(selector);
  const launcher = $('.launcher'), panel = $('.panel');
  const state = { roomInput: '', roomId: '', anchorId: '', uid: '', items: [], ready: false, loading: true, refreshing: false, error: '', failures: 0, generation: 0, open: false };
  const clock = { time: Date.now(), perf: performance.now(), lastSync: 0, now() { return this.time + performance.now() - this.perf; } };
  const positions = {
    windowed: readSetting('launcher-position-windowed-v2', null),
    fullscreen: readSetting('launcher-position-fullscreen-v2', null)
  };
  const positionKey = mode => `launcher-position-${mode}-v2`;
  let pollTimer, tickTimer, presentationTimer, frameTimer, frame = null, frameUrl = '';
  let presentationMode = 'windowed', fullscreenRoot = null;
  let layoutPosition = { x: 24, y: 210 }, dragging = null, suppressClick = false, launcherHovered = false, lastActivity = performance.now();

  function requestJSON(url) {
    if (!['api.live.bilibili.com', 'api.bilibili.com'].includes(new URL(url).hostname)) return Promise.reject(new Error('接口地址无效'));
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({ method: 'GET', url, anonymous: false, timeout: 15000, responseType: 'json',
        headers: { Accept: 'application/json', Referer: `https://live.bilibili.com/${state.roomInput}` },
        onload(response) {
          try {
            if (response.status < 200 || response.status >= 300) throw new Error(`接口返回 HTTP ${response.status}`);
            const payload = response.response && typeof response.response === 'object' ? response.response : JSON.parse(response.responseText);
            if (payload.code == null || Number(payload.code) !== 0) throw new Error(String(payload.message || payload.msg || '接口请求失败'));
            resolve(payload.data);
          } catch (error) { reject(error); }
        },
        onerror: () => reject(new Error('网络连接失败')), ontimeout: () => reject(new Error('请求超时')),
        onabort: () => reject(new Error('请求已取消'))
      });
    });
  }
  const get = (path, params = {}) => requestJSON(`${API}${path}?${new URLSearchParams(params)}`);
  async function syncClock() {
    const started = performance.now();
    try {
      const data = await get('/xlive/open-interface/v1/rtc/getTimestamp');
      const server = num(data?.microtime) || num(data?.timestamp) * 1000;
      if (server > 0) { clock.time = server; clock.perf = (started + performance.now()) / 2; clock.lastSync = performance.now(); }
    } catch { /* The launcher can use the local clock until the next sync. */ }
  }

  function renderLauncher() {
    const summary = summaryOf(state.items, clock.now());
    const label = state.loading && !state.ready ? '加载中' : state.error ? '连接异常' : summary.label;
    launcher.dataset.kind = state.error ? 'error' : summary.kind;
    $('.launcher-label').textContent = label;
    launcher.setAttribute('aria-label', `打开官方直播预言：${label}`);
    launcher.title = `${summary.kind === 'active' ? `${summary.count} 条预言进行中，最近截止 ` : ''}${label}\n点击打开官方预言；拖动可移动图标`;
  }
  function frameNotice(message, link = false) {
    const notice = $('.notice');
    notice.replaceChildren();
    if (message) { const text = document.createElement('p'); text.textContent = message; notice.append(text); }
    if (link && frameUrl) {
      const anchor = document.createElement('a'); anchor.href = frameUrl; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer';
      anchor.textContent = '在新标签页打开官方页面'; notice.append(anchor);
    }
  }
  function ensureFrame() {
    if (!state.ready || !state.open) return;
    const url = buildOfficialUrl(state.anchorId, state.roomId);
    // Closing/reopening and launcher polling never reload the official page.
    if (frame && frameUrl === url) return;
    clearTimeout(frameTimer); frame?.remove(); frameUrl = url;
    frameNotice('正在加载官方预言…');
    frame = document.createElement('iframe'); frame.className = 'official-frame'; frame.title = '哔哩哔哩官方预言';
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    const currentFrame = frame;
    const started = performance.now();
    const checkFrame = () => {
      if (frame !== currentFrame) return;
      try {
        const doc = currentFrame.contentDocument;
        if (doc?.querySelector('#main') && doc.body?.innerText.trim()) {
          clearTimeout(frameTimer); frameNotice(''); return;
        }
      } catch { /* A network/error page may not permit document access. */ }
      if (performance.now() - started >= 20000) {
        frameNotice('官方页面未正常显示，可以在新标签页打开检查。', true); return;
      }
      frameTimer = setTimeout(checkFrame, 500);
    };
    frame.addEventListener('load', () => {
      if (frame !== currentFrame) return;
      clearTimeout(frameTimer); checkFrame();
      try {
        currentFrame.contentDocument?.addEventListener('keydown', event => {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); showPanel(false); }
        });
      } catch { /* Cross-origin access is not needed to render the official UI. */ }
    });
    frame.addEventListener('error', () => {
      if (frame === currentFrame) { clearTimeout(frameTimer); frameNotice('官方页面未能加载，请检查网络后重新打开。', true); }
    });
    frameTimer = setTimeout(checkFrame, 20000);
    frame.src = url; $('.frame-wrap').append(frame);
  }
  function schedule() {
    clearTimeout(pollTimer);
    if (!state.roomInput || !state.ready) return;
    const active = summaryOf(state.items, clock.now()).kind === 'active';
    const interval = document.hidden ? 60000 : state.failures ? Math.min(60000, 10000 * 2 ** (state.failures - 1)) : state.open ? (active ? 4000 : 10000) : 20000;
    pollTimer = setTimeout(refresh, interval);
  }
  async function refresh() {
    if (!state.ready || state.refreshing) return;
    state.refreshing = true;
    const generation = state.generation;
    try {
      if (performance.now() - clock.lastSync > 300000) void syncClock();
      const data = await get('/xlive/app-ucenter/v1/elden/get_by_user', { anchor_id: state.anchorId, uid: state.uid || '0', with_history: 'true' });
      if (generation !== state.generation) return;
      if (!Array.isArray(data?.prophets)) throw new Error('预言状态格式已变化');
      state.items = data.prophets.filter(item => item?.prophet); state.error = ''; state.failures = 0;
    } catch (error) {
      if (generation !== state.generation) return;
      state.error = String(error?.message || '状态读取失败'); state.failures++;
    } finally {
      if (generation === state.generation) { state.refreshing = false; state.loading = false; renderLauncher(); schedule(); }
    }
  }
  async function initialize() {
    const generation = ++state.generation;
    clearTimeout(pollTimer); clearTimeout(frameTimer); frame?.remove(); frame = null; frameUrl = '';
    Object.assign(state, { roomInput: currentRoom(), roomId: '', anchorId: '', uid: '', items: [], ready: false, loading: true, refreshing: false, error: '', failures: 0 });
    host.style.display = state.roomInput ? '' : 'none';
    if (!state.roomInput) return;
    renderLauncher(); if (state.open) frameNotice('正在识别直播间…');
    try {
      const [room, login] = await Promise.all([
        get('/room/v1/Room/room_init', { id: state.roomInput }),
        requestJSON('https://api.bilibili.com/x/web-interface/nav').catch(() => null), syncClock()
      ]);
      if (generation !== state.generation) return;
      if (!room?.uid || !room.room_id) throw new Error('无法识别直播间');
      state.anchorId = String(room.uid); state.roomId = String(room.room_id);
      state.uid = login?.isLogin && login.mid ? String(login.mid) : '';
      state.ready = true; state.loading = false; ensureFrame(); await refresh();
    } catch (error) {
      if (generation !== state.generation) return;
      state.loading = false; state.error = String(error?.message || '直播间读取失败'); renderLauncher();
      if (state.open) frameNotice(state.error);
      pollTimer = setTimeout(initialize, 30000);
    }
  }
  function showPanel(open) {
    state.open = open; panel.hidden = !open; launcher.setAttribute('aria-expanded', String(open));
    if (open) {
      setPosition();
      if (state.ready) { ensureFrame(); void refresh(); }
      else if (!state.loading) void initialize();
      else frameNotice('正在识别直播间…');
    } else launcher.focus();
    syncLauncherVisibility(); schedule();
  }
  function setPosition() {
    if (innerWidth < 100 || innerHeight < 100) return;
    const width = launcher.offsetWidth || 48, height = launcher.offsetHeight || 48;
    const position = positions[presentationMode];
    const x = Number.isFinite(position?.x) ? position.x : 24;
    const y = Number.isFinite(position?.y) ? position.y : Math.min(210, innerHeight * .3);
    layoutPosition = { x: Math.max(8, Math.min(x, innerWidth - width - 8)), y: Math.max(8, Math.min(y, innerHeight - height - 8)) };
    launcher.style.left = `${layoutPosition.x}px`; launcher.style.top = `${layoutPosition.y}px`;
    if (state.open) {
      const pWidth = panel.offsetWidth, pHeight = panel.offsetHeight;
      const rightFits = layoutPosition.x + width + 12 + pWidth < innerWidth - 8;
      panel.style.left = `${Math.max(12, Math.min(rightFits ? layoutPosition.x + width + 12 : layoutPosition.x - pWidth - 12, innerWidth - pWidth - 12))}px`;
      panel.style.top = `${Math.max(12, Math.min(layoutPosition.y - 16, innerHeight - pHeight - 12))}px`;
    }
  }

  function currentFullscreenRoot() {
    const native = document.fullscreenElement || document.querySelector(':fullscreen');
    if (native) return native;
    const player = document.getElementById('fullscreen-container');
    return player && isFullscreenView(false, player.getBoundingClientRect(), innerWidth, innerHeight) ? player : null;
  }

  function toolbarVisible() {
    if (!fullscreenRoot) return true;
    const control = fullscreenRoot.querySelector('#web-player-controller-wrap-el .control-area, .live-web-player-controller .control-area')
      || fullscreenRoot.querySelector('#web-player-controller-wrap-el');
    if (!control) return null;
    // The current controller wrappers have zero height; inspect the actual control area.
    const rect = control.getBoundingClientRect();
    if (!rect.width || !rect.height || rect.bottom <= 0 || rect.top >= innerHeight || rect.right <= 0 || rect.left >= innerWidth) return false;
    for (let node = control; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (node.hidden || node.getAttribute('aria-hidden') === 'true' || style.display === 'none'
        || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity) <= .03) return false;
      if (node === fullscreenRoot) break;
    }
    return true;
  }

  function syncLauncherVisibility() {
    const inUse = state.open || !!dragging || launcherHovered || launcher.matches(':focus-visible');
    const controls = presentationMode === 'fullscreen' && !inUse ? toolbarVisible() : true;
    // Older/replaced players without a controller node still get an idle fallback.
    const hidden = presentationMode === 'fullscreen' && !inUse
      && (controls == null ? performance.now() - lastActivity >= 3000 : !controls);
    if (launcher.dataset.controlsHidden === String(hidden)) return;
    launcher.dataset.controlsHidden = String(hidden);
    launcher.tabIndex = hidden ? -1 : 0;
    if (hidden) launcher.setAttribute('aria-hidden', 'true'); else launcher.removeAttribute('aria-hidden');
  }

  function syncPresentation() {
    const nextRoot = currentFullscreenRoot(), nextMode = nextRoot ? 'fullscreen' : 'windowed';
    if (nextMode !== presentationMode || nextRoot !== fullscreenRoot) {
      finishDrag();
      presentationMode = nextMode; fullscreenRoot = nextRoot; lastActivity = performance.now();
      launcher.dataset.positionMode = presentationMode;
      const parent = nextRoot && !['VIDEO', 'IFRAME'].includes(nextRoot.tagName) ? nextRoot : document.body;
      if (host.parentElement !== parent) {
        // Preserve the official iframe's browsing context when changing fullscreen mode.
        if (typeof parent.moveBefore === 'function') parent.moveBefore(host, null);
        else parent.append(host);
      }
      setPosition();
    }
    syncLauncherVisibility();
  }

  function recordActivity() {
    lastActivity = performance.now();
    if (presentationMode === 'fullscreen' && launcher.dataset.controlsHidden === 'true') syncLauncherVisibility();
  }


  launcher.addEventListener('click', () => {
    if (suppressClick) { suppressClick = false; return; }
    showPanel(!state.open);
  });
  $('.close').addEventListener('click', () => showPanel(false));
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape' && state.open) { event.preventDefault(); event.stopPropagation(); showPanel(false); }
  });
  launcher.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    suppressClick = false; dragging = { x: event.clientX, y: event.clientY, baseX: layoutPosition.x, baseY: layoutPosition.y, mode: presentationMode, moved: false };
    launcher.setPointerCapture(event.pointerId);
  });
  launcher.addEventListener('pointermove', event => {
    if (!dragging) return;
    const dx = event.clientX - dragging.x, dy = event.clientY - dragging.y;
    if (!dragging.moved && Math.hypot(dx, dy) < 6) return;
    if (dragging.mode !== presentationMode) return;
    dragging.moved = true; positions[dragging.mode] = { x: dragging.baseX + dx, y: dragging.baseY + dy }; setPosition();
  });
  const finishDrag = () => {
    if (dragging?.moved && dragging.mode === presentationMode) {
      suppressClick = true; positions[dragging.mode] = { ...layoutPosition };
      saveSetting(positionKey(dragging.mode), positions[dragging.mode]);
    }
    dragging = null;
  };
  launcher.addEventListener('pointerup', finishDrag); launcher.addEventListener('pointercancel', finishDrag);
  launcher.addEventListener('pointerenter', () => { launcherHovered = true; syncLauncherVisibility(); });
  launcher.addEventListener('pointerleave', () => { launcherHovered = false; syncLauncherVisibility(); });
  window.addEventListener('resize', () => { syncPresentation(); setPosition(); });
  document.addEventListener('fullscreenchange', syncPresentation);
  document.addEventListener('pointermove', recordActivity, { passive: true });
  document.addEventListener('pointerdown', recordActivity, { passive: true });
  document.addEventListener('keydown', recordActivity, { passive: true });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.ready) { void syncClock(); void refresh(); }
    schedule();
  });
  tickTimer = setInterval(() => {
    if (currentRoom() !== state.roomInput) { void initialize(); return; }
    renderLauncher();
  }, 1000);
  presentationTimer = setInterval(syncPresentation, 200);
  window.addEventListener('pagehide', event => {
    if (!event.persisted) { clearInterval(tickTimer); clearInterval(presentationTimer); clearTimeout(pollTimer); clearTimeout(frameTimer); }
  });
  try {
    GM_registerMenuCommand('打开官方直播预言', () => showPanel(true));
    GM_registerMenuCommand('重新加载官方预言页面', () => { frame?.remove(); frame = null; showPanel(true); });
    GM_registerMenuCommand('重置当前模式图标位置', () => { positions[presentationMode] = null; saveSetting(positionKey(presentationMode), null); setPosition(); });
  } catch { /* Menu support is optional. */ }
  launcher.dataset.positionMode = presentationMode;
  syncPresentation(); setPosition(); void initialize();
})();
