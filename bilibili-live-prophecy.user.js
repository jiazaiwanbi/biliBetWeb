// ==UserScript==
// @name         哔哩哔哩直播 · 预言
// @namespace    local.bilibili.live.prophecy
// @version      1.0.7
// @description  在电脑直播间查看和参与手机端预言，显示倒计时、公布状态与个人历史。
// @homepageURL  https://github.com/jiazaiwanbi/biliBetWeb
// @downloadURL  https://raw.githubusercontent.com/jiazaiwanbi/biliBetWeb/main/bilibili-live-prophecy.user.js
// @updateURL    https://raw.githubusercontent.com/jiazaiwanbi/biliBetWeb/main/bilibili-live-prophecy.user.js
// @match        https://live.bilibili.com/*
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

/*
 * API and status meanings were checked against the mobile H5 bundle on 2026-11-08.
 * Only an explicit confirmation can call user_join. POST requests are never retried.
 * No account cookie or token is embedded, copied to storage, or logged.
 */
(function () {
  'use strict';

  const API = 'https://api.live.bilibili.com';
  const PATH = '/xlive/app-ucenter/v1/elden/';
  const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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

  function validateVote(item, answer, context, now) {
    if (!context.uid) return '请先登录哔哩哔哩';
    if (String(context.uid) === String(context.anchorId)) return '不能参与自己开启的预言';
    if (![1, 2].includes(answer)) return '请选择一个答案';
    if (!item || !item.prophet) return '这条预言已更新，请刷新后再试';
    if (num(item.my_answer) > 0) return '你已参与这条预言，不能重复参与或更改答案';
    if (statusOf(item, now).kind !== 'active') return '这条预言已截止，等待主播公布';
    if (!Number.isFinite(context.balance)) return '暂时无法读取硬币余额，请刷新后再试';
    if (context.balance < num(item.prophet.smh_spend)) return '硬币不足';
    return '';
  }

  function estimatedProfit(p, answer, extraVoter = false) {
    const counts = p.answer_count || {};
    const own = num(answer === 1 ? counts.a : counts.b) + (extraVoter ? 1 : 0);
    const other = num(answer === 1 ? counts.b : counts.a);
    return Math.floor(num(p.smh_spend) * other / Math.max(1, own));
  }

  function sortItems(items, now) {
    const ranks = { active: 0, pending: 1, idle: 2, settled: 3, cancelled: 4 };
    return [...items].sort((a, b) => {
      const order = ranks[statusOf(a, now).kind] - ranks[statusOf(b, now).kind];
      return order || num(b.prophet?.push_time || b.prophet?.prophet_id) - num(a.prophet?.push_time || a.prophet?.prophet_id);
    });
  }

  function historyDetails(item) {
    const p = item.prophet || {}, q = p.question || {};
    const correct = num(p.correct_answer);
    const answer = correct === 1 ? q.answer_a : correct === 2 ? q.answer_b
      : num(p.prophet_status) === 4 ? '已取消' : num(p.prophet_status) === 3 ? '—' : '未公布';
    const rawDelta = item.smh_num_change;
    const delta = rawDelta != null && String(rawDelta).trim() !== '' && Number.isFinite(Number(rawDelta)) ? Number(rawDelta) : null;
    // History shows the publication time and actual settlement, never a reward estimate.
    const date = new Date(num(p.publish_time) * 1000);
    const pad = value => String(value).padStart(2, '0');
    const time = num(p.publish_time) > 0 && Number.isFinite(date.getTime())
      ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` : '—';
    return { question: q.question || '预言', answer: answer ?? '—', delta, time, anchor: item.anchor_name || p.anchor_name || '—' };
  }

  function isFullscreenView(nativeFullscreen, rect, width, height) {
    // Bilibili's webpage fullscreen also fills the viewport, without the Fullscreen API.
    return !!nativeFullscreen || !!rect && width > 0 && height > 0
      && Math.abs(rect.left) <= 2 && Math.abs(rect.top) <= 2
      && rect.width >= width - 2 && rect.height >= height - 2;
  }

  // Pure helpers are exported only when this file is loaded by the offline Node tests.
  if (typeof module === 'object' && module.exports) {
    module.exports = { secondsLeft, formatTime, statusOf, summaryOf, validateVote, estimatedProfit, sortItems, historyDetails, isFullscreenView, esc };
    return;
  }
  if (window.top !== window.self || document.getElementById('bili-prophecy-desktop')) return;
  if (typeof GM_xmlhttpRequest !== 'function') return;

  const STAR = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="m16 3 3.9 8 8.8 1.3-6.4 6.2 1.5 8.8-7.8-4.1-7.8 4.1 1.5-8.8-6.4-6.2 8.8-1.3Z" fill="currentColor"/></svg>';
  const COIN = '<span class="coin" aria-hidden="true">币</span>';
  const readSetting = (key, fallback) => { try { return GM_getValue(key, fallback); } catch { return fallback; } };
  const saveSetting = (key, value) => { try { GM_setValue(key, value); } catch { /* Nonessential preference. */ } };
  const host = document.createElement('div');
  host.id = 'bili-prophecy-desktop';
  host.style.cssText = 'position:fixed;inset:0 auto auto 0;width:0;height:0;z-index:2147483646;color-scheme:dark;';
  document.body.append(host);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
    :host{all:initial;color-scheme:dark}*{box-sizing:border-box}button,a{-webkit-tap-highlight-color:transparent}
    .app{font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;color:#efedf5}
    button{font:inherit;color:inherit;border:0;cursor:pointer}button:disabled{cursor:not-allowed;opacity:.55}button:focus-visible,a:focus-visible{outline:2px solid #b7a1ff;outline-offset:3px}
    .launcher{position:fixed;width:48px;height:48px;padding:0;display:block;border:1px solid #ffffff24;border-radius:13px;background:linear-gradient(150deg,#7460c980,#29243866);box-shadow:0 4px 15px #0004;touch-action:none;user-select:none;backdrop-filter:blur(6px)}
    .launcher{transition:opacity .15s ease,visibility .15s ease}.launcher[data-controls-hidden=true]{opacity:0;visibility:hidden;pointer-events:none}.launcher:hover{filter:brightness(1.12)}.star-wrap{position:absolute;top:3px;left:50%;transform:translateX(-50%);width:34px;height:34px;display:grid;place-items:center}.star-wrap svg{width:34px;height:34px;color:#e1d6ff;filter:drop-shadow(0 1px 3px #22173966)}.live-dot{display:none;position:absolute;right:1px;top:1px;width:7px;height:7px;border:1px solid #64518c99;border-radius:50%;background:#66edc1}.launcher[data-kind=active] .live-dot{display:block}.launcher-label{position:absolute;z-index:1;bottom:3px;left:50%;transform:translateX(-50%);max-width:44px;padding:0 3px;border:1px solid #ffffff12;border-radius:5px;background:#1b1628a8;color:#e6dcfa;font-size:9px;line-height:13px;white-space:nowrap;font-weight:650;font-variant-numeric:tabular-nums}.launcher[data-kind=active] .launcher-label{color:#9ff4d4;font-size:10px}
    .panel{position:fixed;width:min(424px,calc(100vw - 24px));height:min(708px,calc(100dvh - 32px));display:flex;flex-direction:column;overflow:hidden;border:1px solid #ffffff22;border-radius:18px;background:#141319;box-shadow:0 18px 70px #0008}.panel[hidden]{display:none}.head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:16px 18px 10px}.heading{display:flex;align-items:center;gap:9px}.heading svg{width:19px;height:19px;color:#bea7ff}.heading h2{font-size:18px;font-weight:650;letter-spacing:2px;margin:0}.icon-btn{width:29px;height:29px;border-radius:8px;background:transparent;color:#a8a5b1;font-size:19px;display:grid;place-items:center}.icon-btn:hover{background:#ffffff0d;color:white}.notice{margin:0 18px 10px;padding:9px 11px;border:1px solid #f1c27033;background:#c4913210;border-radius:9px;color:#e6c487;font-size:12px;overflow-wrap:anywhere}.notice:empty{display:none}.list{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:0 12px 16px;scrollbar-width:thin;scrollbar-color:#51475d transparent}.list:focus{outline:none}.card{background:#29262f;border-radius:9px;padding:12px 12px 10px;margin:0 0 9px}.card-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:8px}.question{font-size:16px;line-height:1.6;margin:0;font-weight:500;overflow-wrap:anywhere}.status-area{flex-shrink:0;text-align:right;font-size:11px;line-height:1.45;color:#918b9e}.status{white-space:nowrap}.status.active{color:#cab5ff}.status.settled{color:#9cdbc4}.status.pending{color:#dbbd87}.status.cancelled{color:#aaa3b7}.ticket{font-size:10px;color:#9e98ad;white-space:nowrap}.clock{font-variant-numeric:tabular-nums;font-weight:650;color:#dbccff;font-size:13px}.clock.urgent{color:#ff9eaf}.choices{display:grid;grid-template-columns:minmax(0,1fr) 30px minmax(0,1fr);align-items:stretch;gap:6px}.versus{display:grid;place-items:center;color:#6b6478;font-style:italic;font-size:21px;font-weight:900;letter-spacing:-3px}.choice{min-height:48px;padding:5px 6px;position:relative;border-radius:7px;border:1px solid transparent;background:#33303d;text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;overflow-wrap:anywhere}.choice .answer{font-size:15px;line-height:20px;position:relative;z-index:1}.choice:disabled{opacity:1;color:#9a94a7}.choice.selectable:hover{border-color:#9a80c7;background:#3d364b}.choice.selected-a{background:#053c50;border-color:#00afdc;color:#94eaff}.choice.selected-b{background:#542238;border-color:#f65c97;color:#ffb8d0}.choice.settled-a{background:#176e8b;border-color:transparent;color:#d1d2dc}.choice.settled-b{background:#8b4261;border-color:transparent;color:#d1d2dc}.choice .selected-label{font-size:10px;position:absolute;z-index:2;top:3px;right:5px;color:inherit}.choice .profit{font-size:10px;line-height:12px;opacity:.72}.choice .result-mark{position:absolute;left:7px;top:50%;transform:translateY(-50%);width:46px;height:46px;color:#c2bacb;opacity:.25;pointer-events:none}.choice .result-mark svg{display:block;width:100%;height:100%}.pool{height:16px;border-radius:10px;overflow:hidden;display:flex;background:#403747;margin-top:9px;font-size:10px;line-height:16px;font-variant-numeric:tabular-nums;position:relative}.pool-a{background:#00aed9;transition:width .3s;min-width:0}.pool-b{background:#f65593;flex:1}.pool-values{position:absolute;inset:0 10px;display:flex;justify-content:space-between;color:#fff;pointer-events:none}.gain{color:#f58bb0}.loss{color:#a8a2b1}.empty{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:235px;gap:9px;color:#92899e;text-align:center;padding:24px}.empty svg{width:38px;height:38px;color:#5e526c;margin-bottom:6px}.empty strong{font-size:14px;color:#c4b9cf;font-weight:500}.empty small{font-size:11px;line-height:1.7}.footer{flex-shrink:0;padding:13px 17px;background:#211f27;display:flex;align-items:center;justify-content:space-between;gap:8px;border-top:1px solid #ffffff07}.wallet{display:flex;align-items:center;gap:6px;font-size:14px}.coin{width:17px;height:17px;border:1px solid #b9b4c7;border-radius:50%;display:inline-grid;place-items:center;font-size:10px;line-height:1;color:#dad4e4;flex-shrink:0}.text-button{background:transparent;color:#a49bae;font-size:11px;padding:3px}.text-button:hover{color:#e0c8ff}.load-more{width:100%;background:#2a2434;border-radius:8px;padding:10px;color:#c4b4df;font-size:12px}.modal-layer{position:absolute;inset:0;z-index:5;display:grid;place-items:center;background:#09070dbb;backdrop-filter:blur(4px);padding:23px}.modal-layer[hidden]{display:none}.modal{width:100%;padding:23px 20px 18px;background:#2b2635;border:1px solid #ffffff16;border-radius:14px;box-shadow:0 12px 32px #0005}.modal h3{font-size:16px;margin:0 0 17px}.modal p{font-size:13px;color:#bdb3ca;margin:9px 0}.modal .picked{font-size:17px;color:#f2eafa;font-weight:600}.modal .charge{display:flex;align-items:baseline;justify-content:space-between;gap:10px;white-space:nowrap;color:#e8d3ab;font-size:11px}.modal .return{color:#c9bbdb}.modal-actions{display:flex;gap:9px;margin-top:21px}.modal-actions button{flex:1;border-radius:9px;padding:11px 7px;font-size:12px;background:#433a50}.modal-actions .confirm{background:#a386dd;color:#17111f;font-weight:650}.toast{position:absolute;z-index:10;bottom:70px;left:18px;right:18px;background:#eee5fa;color:#352944;border-radius:10px;padding:11px 13px;font-size:12px;box-shadow:0 7px 22px #0005;pointer-events:none}.toast[hidden]{display:none}.sr-only{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0,0,0,0)}
    .room-view{display:flex;flex-direction:column;flex:1;min-height:0}.history-view{position:absolute;inset:0;z-index:3;display:flex;flex-direction:column;background:#141319;border-radius:inherit;overflow:hidden}.history-view[hidden]{display:none}.history-head{display:flex;position:relative;align-items:center;justify-content:center;flex-shrink:0;height:56px;margin-bottom:7px;padding:0 16px}.history-head h2{margin:0;font-size:18px;font-weight:500}.history-back{position:absolute;left:13px;width:32px;height:36px;background:transparent;color:#e4e1e9;display:grid;place-items:center;border-radius:7px}.history-back:hover{background:#ffffff0d}.history-back{font-size:25px;font-weight:400;line-height:1}.panel[data-view=history] .toast{bottom:18px}.history-card{background:#29262f;border-radius:6px;padding:15px 17px 17px;margin-bottom:11px}.history-top{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:9px}.history-question{margin:0;color:#efedf2;font-size:16px;font-weight:400;line-height:1.5;overflow-wrap:anywhere}.history-time{flex-shrink:0;color:#929198;font-size:12px;white-space:nowrap;font-variant-numeric:tabular-nums}.history-result,.history-anchor{margin:0;color:#96949e;font-size:13px;line-height:1.7;overflow-wrap:anywhere}.history-result{display:flex;flex-wrap:wrap;column-gap:20px;row-gap:2px;margin-bottom:4px}.history-value{color:#dfdce5}.history-delta.gain{color:#ff669e}.history-delta.loss,.history-delta.neutral{color:#dfdce5}.history-end{text-align:center;color:#76717f;font-size:11px;padding:8px 0}.panel[data-view=history] .load-more{margin-top:3px}
    @media(prefers-reduced-motion:reduce){*{transition:none!important}}@media(max-width:480px){.panel{height:min(690px,calc(100dvh - 24px))}.question{font-size:15px}.modal .charge{font-size:10px;gap:7px}.history-top{gap:8px;flex-wrap:wrap}.history-question{font-size:15px}.history-time{font-size:11px}.history-card{padding:13px 14px 15px}.history-result,.history-anchor{font-size:12px}}
  </style><div class="app">
    <button class="launcher" aria-label="打开直播预言" aria-expanded="false" data-kind="idle" title="点击打开预言；拖动可移动图标"><span class="star-wrap">${STAR}<i class="live-dot"></i></span><span class="launcher-label">加载中</span></button>
    <section class="panel" role="dialog" aria-label="直播预言" hidden>
      <div class="room-view">
        <header class="head"><div class="heading">${STAR}<h2>预言</h2></div><button class="icon-btn" data-action="close" aria-label="关闭预言" title="关闭">×</button></header>
        <div class="notice room-notice" role="status"></div><div class="list room-list" tabindex="0" aria-label="预言列表"></div>
        <footer class="footer"><span class="wallet">${COIN}<span class="balance">—</span></span><button class="text-button" data-action="history">预言历史</button></footer>
      </div>
      <section class="history-view" aria-label="我的预言" hidden>
        <header class="history-head"><button class="history-back" data-action="back-to-room" aria-label="返回直播间预言" title="返回"><span aria-hidden="true">←</span></button><h2>我的预言</h2></header>
        <div class="notice history-notice" role="status"></div><div class="list history-list" tabindex="0" aria-label="我的预言历史列表"></div>
      </section>
      <div class="modal-layer" hidden></div><div class="toast" role="status" hidden></div>
    </section></div>`;
  const $ = selector => root.querySelector(selector);
  const launcher = $('.launcher'), panel = $('.panel'), list = $('.room-list'), historyList = $('.history-list');
  const state = {
    roomInput: '', roomId: '', anchorId: '', uid: '', username: '', items: [], history: [], balance: null,
    open: false, tab: 'room', ready: false, loading: true, refreshing: false, error: '', historyError: '',
    historyLoading: false, historyLoaded: false, lastUpdated: 0, failures: 0, generation: 0, visibleCount: 30, historyVisibleCount: 30,
    confirmation: null, submitting: false, unknownVotes: new Set(), acknowledgedVotes: new Map(), expired: new Set()
  };
  const clock = { time: Date.now(), perf: performance.now(), synced: false, lastSync: 0, now() { return this.time + performance.now() - this.perf; } };
  const positions = {
    windowed: readSetting('launcher-position-windowed-v2', readSetting('launcher-position-v1', null)),
    fullscreen: readSetting('launcher-position-fullscreen-v2', null)
  };
  const positionKey = mode => `launcher-position-${mode}-v2`;
  let pollTimer, toastTimer, tickTimer, presentationTimer, presentationMode = 'windowed', fullscreenRoot = null;
  let layoutPosition = { x: 24, y: 210 }, dragging = null, suppressClick = false, launcherHovered = false, lastActivity = performance.now();
  const currentRoom = () => location.pathname.match(/^\/(\d+)(?:\/|$)/)?.[1] || '';
  const voteKey = (id, uid = state.uid) => `${uid}:${id}`;
  const errorText = error => String(error?.message || '请求失败，请稍后刷新').slice(0, 160);

  function requestJSON(url, method = 'GET', data = null) {
    if (!['api.live.bilibili.com', 'api.bilibili.com'].includes(new URL(url).hostname)) return Promise.reject(new Error('接口地址无效'));
    return new Promise((resolve, reject) => {
      const headers = { Accept: 'application/json', Referer: `https://live.bilibili.com/${state.roomInput}`, Origin: 'https://live.bilibili.com' };
      if (method === 'POST') headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
      GM_xmlhttpRequest({
        method, url, headers, data: data ? new URLSearchParams(data).toString() : undefined,
        anonymous: false, timeout: 15000, responseType: 'json',
        onload(response) {
          if (response.status < 200 || response.status >= 300) return reject(new Error(`接口返回 HTTP ${response.status}，请稍后刷新`));
          let payload = response.response;
          if (!payload || typeof payload !== 'object') {
            try { payload = JSON.parse(response.responseText); } catch { return reject(new Error('接口没有返回有效数据，请稍后刷新')); }
          }
          if (Number(payload.code) !== 0 || payload.code == null) return reject(new Error(`${payload.message || payload.msg || '接口请求失败'}${payload.code != null ? `（${payload.code}）` : ''}`));
          resolve(payload.data);
        },
        onerror: () => reject(new Error('网络连接失败，请检查网络或脚本的接口访问权限')),
        ontimeout: () => reject(new Error('请求超时，请稍后刷新')),
        onabort: () => reject(new Error('请求已取消'))
      });
    });
  }
  const get = (path, params = {}) => requestJSON(`${API}${path}?${new URLSearchParams(params)}`);
  const loadList = () => get(`${PATH}get_by_user`, { anchor_id: state.anchorId, uid: state.uid || '0', with_history: 'true' });

  async function syncClock() {
    const started = performance.now();
    try {
      const data = await get('/xlive/open-interface/v1/rtc/getTimestamp');
      const server = num(data?.microtime) || num(data?.timestamp) * 1000;
      if (server <= 0) return;
      clock.time = server; clock.perf = (started + performance.now()) / 2; clock.synced = true; clock.lastSync = performance.now();
    } catch { /* Keep local/previous time; state always comes from the server. */ }
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
      if (host.parentElement !== parent) parent.append(host);
      setPosition();
    }
    syncLauncherVisibility();
  }

  function recordActivity() {
    lastActivity = performance.now();
    if (presentationMode === 'fullscreen' && launcher.dataset.controlsHidden === 'true') syncLauncherVisibility();
  }

  function empty(title, detail = '') {
    return `<div class="empty">${STAR}<strong>${esc(title)}</strong>${detail ? `<small>${esc(detail)}</small>` : ''}</div>`;
  }

  function historyCard(item) {
    const details = historyDetails(item);
    const delta = details.delta;
    const change = delta == null ? '—' : `${delta > 0 ? '+' : ''}${delta.toLocaleString('zh-CN')}`;
    return `<article class="history-card">
      <div class="history-top"><h3 class="history-question">${esc(details.question)}</h3><time class="history-time">${esc(details.time)}</time></div>
      <p class="history-result"><span>题目答案：<span class="history-value">${esc(details.answer)}</span></span><span>硬币：<span class="history-delta ${delta > 0 ? 'gain' : delta < 0 ? 'loss' : 'neutral'}">${esc(change)}</span></span></p>
      <p class="history-anchor">主播名称：<span class="history-value">${esc(details.anchor)}</span></p></article>`;
  }

  function card(item) {
    const p = item.prophet || {}, q = p.question || {}, status = statusOf(item, clock.now());
    const id = num(p.prophet_id), chosen = num(item.my_answer), correct = num(p.correct_answer), cost = num(p.smh_spend);
    const counts = p.answer_count || {}, a = num(counts.a) * cost, b = num(counts.b) * cost;
    const pct = a + b > 0 ? (a / (a + b) * 100) : 50;
    const stale = Date.now() - state.lastUpdated > 20000;
    const selectable = status.kind === 'active' && !chosen && !!state.uid && !state.submitting && !state.unknownVotes.has(voteKey(id)) && !stale && String(state.uid) !== String(state.anchorId);
    const money = value => num(value).toLocaleString('zh-CN');
    let reward = '';
    if (status.kind === 'settled' && chosen) {
      const delta = Number.isFinite(Number(item.smh_num_change)) && item.smh_num_change != null
        ? Number(item.smh_num_change) : (chosen === correct ? estimatedProfit(p, chosen) : -cost);
      reward = `<span class="${delta > 0 ? 'gain' : 'loss'}">${delta > 0 ? '+' : ''}${money(delta)} 硬币</span>`;
    }
    const buttons = [1, 2].map(answer => {
      const isChosen = chosen === answer, won = correct === answer && status.kind === 'settled';
      const settled = status.kind === 'settled', hasResult = settled && [1, 2].includes(correct);
      const resultMark = hasResult ? `<span class="result-mark" aria-hidden="true"><svg viewBox="0 0 48 48"><path d="${won ? 'm8 24 10 10 23-23' : 'm12 12 24 24m0-24L12 36'}" fill="none" stroke="currentColor" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/></svg></span>` : '';
      return `<button class="choice ${selectable ? 'selectable' : ''} ${isChosen ? (answer === 1 ? 'selected-a' : 'selected-b') : ''} ${settled ? (answer === 1 ? 'settled-a' : 'settled-b') : ''}" data-vote="${id}" data-answer="${answer}" ${selectable ? '' : 'disabled'} aria-label="${esc(q.question)}：${esc(answer === 1 ? q.answer_a : q.answer_b)}${isChosen ? '，你已选择' : ''}${hasResult ? (won ? '，正确答案' : '，错误答案') : ''}">
        ${resultMark}${isChosen ? '<span class="selected-label">已选</span>' : ''}<span class="answer">${esc(answer === 1 ? q.answer_a : q.answer_b)}</span>
        ${['active', 'pending'].includes(status.kind) ? `<span class="profit">预计额外奖励 ${money(estimatedProfit(p, answer, status.kind === 'active' && !chosen))} 硬币</span>` : ''}</button>`;
    });
    const statusLine = status.kind === 'active'
      ? `<span class="clock" data-deadline="${num(p.count_down_time)}">${formatTime(secondsLeft(p, clock.now()))}</span> 截止`
      : !chosen ? '未参与' : status.kind === 'pending' ? '等待结算' : reward || (status.kind === 'cancelled' ? '已取消' : status.kind === 'settled' ? '已结算' : '已参与');
    const firstLine = status.kind === 'active' ? `<div class="ticket">门票 ${money(cost)} 硬币</div>`
      : `<div class="status ${status.kind}" data-status="${id}">${status.label}</div>`;
    return `<article class="card" data-id="${id}">
      <div class="card-top"><h3 class="question">${esc(q.question || '预言')}</h3><div class="status-area">${firstLine}<div>${statusLine}</div></div></div>
      <div class="choices">${buttons[0]}<span class="versus">VS</span>${buttons[1]}</div>
      <div class="pool" aria-label="两边投入硬币：${a} 和 ${b}"><span class="pool-a" style="width:${pct}%"></span><span class="pool-b"></span><span class="pool-values"><span>${money(a)}</span><span>${money(b)}</span></span></div></article>`;
  }

  function render() {
    const scrollTop = list.scrollTop, historyScrollTop = historyList.scrollTop;
    const focusedVote = root.activeElement?.dataset?.vote;
    const focusedAnswer = root.activeElement?.dataset?.answer;
    const historical = state.tab === 'history';
    panel.dataset.view = state.tab;
    panel.setAttribute('aria-label', historical ? '我的预言' : '直播预言');
    $('.history-view').hidden = !historical;
    $('.room-view').inert = historical;
    $('.room-view').setAttribute('aria-hidden', String(historical));
    $('.balance').textContent = state.balance == null ? '—' : num(state.balance).toLocaleString('zh-CN');
    $('.room-notice').textContent = state.error || (!state.uid && !state.loading ? '请先在网页端登录哔哩哔哩，再刷新页面。' : '') || (!clock.synced && !state.loading ? '时间同步暂不可用，倒计时可能有偏差。' : '');
    $('.history-notice').textContent = state.historyError;
    if (state.loading && !state.items.length) list.innerHTML = empty('正在读取预言…');
    else if (state.items.length) {
      list.innerHTML = sortItems(state.items, clock.now()).slice(0, state.visibleCount).map(card).join('') + (state.items.length > state.visibleCount ? '<button class="load-more" data-action="more">显示更多预言</button>' : '');
    } else list.innerHTML = empty(state.error ? '暂时无法读取预言' : '主播暂未开启预言', '有新的预言时，五角星会自动显示倒计时。');
    if (historical) {
      if (!state.uid) historyList.innerHTML = empty('登录后查看预言历史', '脚本自动使用网页的登录状态，无需填写 Cookie。');
      else if (state.historyLoading && !state.historyLoaded) historyList.innerHTML = empty('正在读取历史…');
      else if (state.historyError && !state.historyLoaded) historyList.innerHTML = empty('历史读取失败', state.historyError) + '<button class="load-more" data-action="retry-history">重新读取</button>';
      else if (!state.history.length) historyList.innerHTML = empty('还没有预言记录', '参与过的预言会显示在这里。');
      else historyList.innerHTML = state.history.slice(0, state.historyVisibleCount).map(historyCard).join('') + (state.history.length > state.historyVisibleCount ? '<button class="load-more" data-action="more">显示更多记录</button>' : '<div class="history-end">已显示服务端本次返回的全部记录</div>');
    }
    list.scrollTop = scrollTop;
    historyList.scrollTop = historyScrollTop;
    if (!historical && focusedVote && focusedAnswer) {
      const replacement = root.querySelector(`[data-vote="${Number(focusedVote)}"][data-answer="${Number(focusedAnswer)}"]`);
      if (replacement && !replacement.disabled) replacement.focus({ preventScroll: true });
    }
    renderLauncher();
  }

  function renderLauncher() {
    const summary = summaryOf(state.items, clock.now());
    const label = state.loading && !state.ready ? '加载中' : state.error ? '连接异常' : summary.label;
    launcher.dataset.kind = state.error ? 'error' : summary.kind;
    $('.launcher-label').textContent = label;
    const description = summary.kind === 'active' ? `${summary.count} 条预言进行中，最近截止 ${summary.label}` : label;
    launcher.setAttribute('aria-label', `打开直播预言：${description}`);
    launcher.title = `${description}\n点击打开预言；拖动可移动图标`;
  }

  function toast(message) {
    clearTimeout(toastTimer); $('.toast').textContent = message; $('.toast').hidden = false;
    toastTimer = setTimeout(() => { $('.toast').hidden = true; }, 5000);
  }

  function schedule() {
    clearTimeout(pollTimer);
    if (!state.roomInput || !state.ready) return;
    const active = summaryOf(state.items, clock.now()).kind === 'active';
    const interval = document.hidden ? 60000 : state.failures ? Math.min(60000, 10000 * 2 ** (state.failures - 1)) : state.open ? (active ? 4000 : 10000) : 20000;
    pollTimer = setTimeout(refresh, interval);
  }

  function applyList(data) {
    if (!data || !Array.isArray(data.prophets)) throw new Error('预言列表格式已变化，请更新脚本');
    state.items = data.prophets.filter(x => x && x.prophet && num(x.prophet.prophet_id) > 0);
    // A successful submit must remain selected even if the read API briefly lags.
    for (const item of state.items) {
      const acknowledged = state.acknowledgedVotes.get(voteKey(num(item.prophet.prophet_id)));
      if (!num(item.my_answer) && acknowledged) item.my_answer = acknowledged;
    }
    const balance = data.user_smh_num;
    state.balance = balance != null && Number.isFinite(Number(balance)) ? Number(balance) : null;
    state.lastUpdated = Date.now(); state.error = ''; state.failures = 0;
  }

  async function refresh() {
    if (state.refreshing || !state.ready || state.submitting) return;
    const generation = state.generation;
    state.refreshing = true;
    try {
      if (performance.now() - clock.lastSync > 300000) void syncClock();
      const data = await loadList();
      if (generation !== state.generation) return;
      applyList(data);
    } catch (error) {
      if (generation !== state.generation) return;
      state.error = errorText(error); state.failures++;
    } finally {
      if (generation === state.generation) { state.refreshing = false; state.loading = false; render(); schedule(); }
    }
  }

  async function loadHistory(force = false) {
    if (!state.uid || state.historyLoading || (state.historyLoaded && !force)) return;
    const generation = state.generation;
    state.historyLoading = true; state.historyError = ''; render();
    try {
      const data = await get(`${PATH}hsitory_user`, { uid: state.uid });
      if (generation !== state.generation) return;
      if (!Array.isArray(data?.prophet_history)) throw new Error('历史列表格式已变化，请更新脚本');
      state.history = data.prophet_history.filter(x => x && x.prophet); state.historyLoaded = true;
    } catch (error) { if (generation === state.generation) state.historyError = errorText(error); }
    finally { if (generation === state.generation) { state.historyLoading = false; render(); } }
  }

  async function initialize() {
    const generation = ++state.generation;
    clearTimeout(pollTimer);
    Object.assign(state, { roomInput: currentRoom(), roomId: '', anchorId: '', uid: '', username: '', items: [], history: [], balance: null, ready: false, loading: true, refreshing: false, error: '', historyError: '', historyLoading: false, historyLoaded: false, lastUpdated: 0, failures: 0, tab: 'room', visibleCount: 30, historyVisibleCount: 30, confirmation: null });
    state.expired.clear(); $('.modal-layer').hidden = true;
    host.style.display = state.roomInput ? '' : 'none';
    if (!state.roomInput) return;
    render(); setPosition();
    try {
      const [room, login] = await Promise.all([
        get('/room/v1/Room/room_init', { id: state.roomInput }),
        requestJSON('https://api.bilibili.com/x/web-interface/nav').catch(() => null), syncClock()
      ]);
      if (generation !== state.generation) return;
      if (!room?.uid) throw new Error('无法识别直播间主播，请稍后刷新');
      state.roomId = String(room.room_id); state.anchorId = String(room.uid);
      if (login?.isLogin && login.mid) { state.uid = String(login.mid); state.username = login.uname || '已登录'; }
      state.ready = true; state.loading = false;
      await refresh();
    } catch (error) {
      if (generation !== state.generation) return;
      state.loading = false; state.error = errorText(error); render();
      pollTimer = setTimeout(initialize, 30000);
    }
  }

  function showPanel(open) {
    if (!open && state.submitting) return;
    state.open = open; panel.hidden = !open; launcher.setAttribute('aria-expanded', String(open));
    if (open) { setPosition(); if (state.ready) { void refresh(); if (state.tab === 'history') void loadHistory(true); } else if (!state.loading) void initialize(); }
    else { dismissConfirmation(); launcher.focus(); }
    syncLauncherVisibility(); schedule();
  }

  function switchView(view) {
    state.tab = view;
    if (view === 'history') { state.historyVisibleCount = 30; historyList.scrollTop = 0; }
    render();
    $(view === 'history' ? '[data-action="back-to-room"]' : '[data-action="history"]').focus();
    if (view === 'history') void loadHistory(true);
  }

  function dismissConfirmation() {
    if (state.submitting) return;
    state.confirmation = null; $('.modal-layer').hidden = true;
  }

  function askVote(id, answer) {
    if (state.submitting || state.confirmation) return;
    const item = state.items.find(x => num(x.prophet.prophet_id) === id);
    const reason = validateVote(item, answer, state, clock.now());
    if (reason) return toast(reason);
    if (Date.now() - state.lastUpdated > 20000 || currentRoom() !== state.roomInput) return toast('预言数据已更新，请先刷新');
    const p = item.prophet, choice = answer === 1 ? p.question.answer_a : p.question.answer_b;
    state.confirmation = { id, answer, room: state.roomInput, uid: state.uid, cost: num(p.smh_spend), choice: String(choice) };
    $('.modal-layer').innerHTML = `<div class="modal" role="alertdialog" aria-modal="true" aria-labelledby="prophecy-confirm-title"><h3 id="prophecy-confirm-title">${esc(p.question.question)}</h3><p>我猜：<span class="picked">${esc(choice)}</span></p><p class="charge"><span>消耗 ${num(p.smh_spend)} 硬币</span><span class="return">猜对预计额外获得 ${estimatedProfit(p, answer, true)} 硬币</span></p><div class="modal-actions"><button data-action="cancel-vote">再想想</button><button class="confirm" data-action="confirm-vote">确定</button></div></div>`;
    $('.modal-layer').hidden = false; $('[data-action="cancel-vote"]').focus();
  }

  function csrfCookie() {
    const value = document.cookie.split(';').map(x => x.trim()).find(x => x.startsWith('bili_jct='))?.slice(9) || '';
    try { return decodeURIComponent(value); } catch { return value; }
  }

  async function submitVote() {
    const confirmation = state.confirmation;
    if (!confirmation || state.submitting || state.unknownVotes.has(voteKey(confirmation.id, confirmation.uid))) return;
    const generation = state.generation;
    let postStarted = false;
    state.submitting = true;
    root.querySelectorAll('.modal-actions button').forEach(x => { x.disabled = true; });
    $('[data-action="confirm-vote"]').textContent = '正在确认…';
    try {
      if (confirmation.room !== currentRoom()) throw new Error('直播间已切换，请重新选择');
      const csrf = csrfCookie();
      if (!csrf) throw new Error('网页登录状态不完整，请重新登录后再试');
      const [login, latest, wallet] = await Promise.all([
        requestJSON('https://api.bilibili.com/x/web-interface/nav'), loadList(),
        get(`${PATH}is_in_fans_group`, { anchor_id: state.anchorId, uid: state.uid })
      ]);
      if (generation !== state.generation || confirmation.room !== currentRoom()) throw new Error('直播间已切换，请重新选择');
      if (!login?.isLogin || String(login.mid) !== confirmation.uid) throw new Error('登录账号已变化，请刷新后再参与');
      applyList(latest);
      const item = state.items.find(x => num(x.prophet.prophet_id) === confirmation.id);
      const walletBalance = wallet?.smh_num;
      if (walletBalance != null && Number.isFinite(Number(walletBalance))) state.balance = Number(walletBalance);
      const reason = validateVote(item, confirmation.answer, state, clock.now());
      if (reason) throw new Error(reason);
      const choice = confirmation.answer === 1 ? item.prophet.question.answer_a : item.prophet.question.answer_b;
      if (num(item.prophet.smh_spend) !== confirmation.cost || String(choice) !== confirmation.choice) throw new Error('预言内容已更新，请重新确认');
      $('[data-action="confirm-vote"]').textContent = '提交中…';
      postStarted = true;
      const result = await requestJSON(`${API}${PATH}user_join`, 'POST', {
        anchor_id: state.anchorId, uid: state.uid, prophet_id: confirmation.id, answer: confirmation.answer,
        csrf, csrf_token: csrf, visit_id: ''
      });
      void result;
      if (generation === state.generation) {
        state.acknowledgedVotes.set(voteKey(confirmation.id, confirmation.uid), confirmation.answer);
        item.my_answer = confirmation.answer;
        state.balance = Math.max(0, num(state.balance) - confirmation.cost);
        state.historyLoaded = false; toast('参与成功，等待主播公布结果');
      }
    } catch (error) {
      if (postStarted) {
        // Even an error response may be a gateway error after server commit. Never auto-retry.
        state.unknownVotes.add(voteKey(confirmation.id, confirmation.uid));
        toast(`${errorText(error)}。请先查看参与记录，确认结果后再刷新页面。`);
      } else toast(errorText(error));
    } finally {
      state.submitting = false; dismissConfirmation();
      if (generation === state.generation) { render(); void refresh(); }
    }
  }

  root.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    if (button === launcher) {
      if (suppressClick) { suppressClick = false; return; }
      return showPanel(!state.open);
    }
    if (button.dataset.vote) return askVote(num(button.dataset.vote), num(button.dataset.answer));
    switch (button.dataset.action) {
      case 'close': return showPanel(false);
      case 'history': return switchView('history');
      case 'back-to-room': return switchView('room');
      case 'retry-history': return void loadHistory(true);
      case 'more': {
        const historical = state.tab === 'history', target = historical ? historyList : list, top = target.scrollTop;
        if (historical) state.historyVisibleCount += 30; else state.visibleCount += 30;
        render(); target.scrollTop = top; return;
      }
      case 'cancel-vote': return dismissConfirmation();
      case 'confirm-vote': return void submitVote();
      default: break;
    }
  });

  root.addEventListener('keydown', event => {
    if (event.key === 'Escape' && state.open) {
      event.preventDefault(); event.stopPropagation();
      if (state.confirmation) dismissConfirmation(); else if (state.tab === 'history') switchView('room'); else showPanel(false);
    }
    if (event.key === 'Tab' && state.confirmation) {
      const buttons = [...root.querySelectorAll('.modal-actions button:not(:disabled)')];
      if (!buttons.length) return;
      const first = buttons[0], last = buttons.at(-1);
      if (event.shiftKey && root.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && root.activeElement === last) { event.preventDefault(); first.focus(); }
    }
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

  function tick() {
    if (currentRoom() !== state.roomInput) { void initialize(); return; }
    if (!state.roomInput) return;
    let transitioned = false;
    root.querySelectorAll('[data-deadline]').forEach(node => {
      const left = secondsLeft({ count_down_time: node.dataset.deadline }, clock.now());
      node.textContent = left > 0 ? formatTime(left) : '00:00'; node.classList.toggle('urgent', left > 0 && left <= 15);
    });
    for (const item of state.items) {
      const id = num(item.prophet.prophet_id);
      if (num(item.prophet.prophet_status) === 1 && secondsLeft(item.prophet, clock.now()) === 0 && !state.expired.has(id)) {
        state.expired.add(id); transitioned = true;
      }
    }
    if (transitioned) { render(); void refresh(); }
    if (state.open && Date.now() - state.lastUpdated > 20000) root.querySelectorAll('[data-vote]').forEach(button => { button.disabled = true; });
    renderLauncher();
  }
  tickTimer = setInterval(tick, 1000);
  presentationTimer = setInterval(syncPresentation, 200);
  window.addEventListener('pagehide', event => { if (!event.persisted) { clearInterval(tickTimer); clearInterval(presentationTimer); clearTimeout(pollTimer); clearTimeout(toastTimer); } });
  try {
    GM_registerMenuCommand('打开直播预言', () => showPanel(true));
    GM_registerMenuCommand('重置当前模式图标位置', () => { positions[presentationMode] = null; saveSetting(positionKey(presentationMode), null); setPosition(); });
  } catch { /* Menu support is optional. */ }
  launcher.dataset.positionMode = presentationMode;
  syncPresentation(); setPosition(); void initialize();
})();
