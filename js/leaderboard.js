/* Color Sort — online leaderboards (Google Sheets via an Apps Script web app). */
(function () {
  'use strict';

  const URL_ = ((window.COLORSORT_CONFIG || {}).leaderboardUrl || '').trim();
  const PLAYER_KEY = 'colorsort.player.v1';
  const PENDING_KEY = 'colorsort.pending.v1';
  const $ = (s) => document.querySelector(s);

  function load(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; } catch (e) { return fallback; }
  }
  function store(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }

  const player = load(PLAYER_KEY, null) || (() => {
    let id = 'p';
    const bytes = new Uint8Array(12);
    (window.crypto || {}).getRandomValues ? crypto.getRandomValues(bytes) : bytes.forEach((_, i) => { bytes[i] = Math.random() * 256; });
    bytes.forEach((b) => { id += (b % 36).toString(36); });
    const p = { id, name: 'Player ' + (1000 + Math.floor(Math.random() * 9000)) };
    store(PLAYER_KEY, p);
    return p;
  })();

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function fmtTime(sec) {
    sec = Math.max(0, sec | 0);
    return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
  }
  function boardLabel(board) {
    if (board[0] === 'D') return 'Daily ' + board.slice(6).replace('-', '/');
    return 'Level ' + board.slice(1);
  }

  // ---------- Network ----------
  async function request(method, params, body) {
    if (!URL_) throw new Error('Leaderboard not configured');
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 15000);
    try {
      const qs = params ? '?' + new URLSearchParams(params).toString() : '';
      const res = await fetch(URL_ + qs, {
        method,
        // text/plain keeps this a "simple" request, which Apps Script accepts cross-origin.
        headers: body ? { 'Content-Type': 'text/plain;charset=utf-8' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: ctl.signal,
        redirect: 'follow',
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Request failed');
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  const fetchBoard = (board) => request('GET', { action: 'board', board, player: player.id });
  const fetchTop = () => request('GET', { action: 'top', player: player.id });

  // Solves that failed to post (offline, etc.) are retried later.
  function queue(entry) {
    const q = load(PENDING_KEY, []);
    q.push(entry);
    store(PENDING_KEY, q.slice(-20));
  }
  async function flushPending() {
    if (!URL_) return;
    const q = load(PENDING_KEY, []);
    if (!q.length) return;
    store(PENDING_KEY, []);
    for (const entry of q) {
      try { await request('POST', null, entry); } catch (e) {
        if (!/^bad /.test(e.message)) queue(entry);
      }
    }
  }

  async function submit(result) {
    const entry = Object.assign({ action: 'submit', player: player.id, name: player.name }, result);
    try {
      return await request('POST', null, entry);
    } catch (e) {
      if (e.name === 'AbortError' || e instanceof TypeError) queue(entry);
      throw e;
    }
  }

  // ---------- UI ----------
  let tab = 'level';
  let currentBoard = 'L1';
  let dailyBoard = 'D';
  let reqId = 0;

  function open(board, daily, which) {
    currentBoard = board;
    dailyBoard = daily;
    tab = which || (board[0] === 'D' ? 'daily' : 'level');
    $('#lb-name').value = player.name;
    $('#lb').hidden = false;
    renderTab();
  }

  function renderTab() {
    document.querySelectorAll('.lb-tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    const body = $('#lb-body');
    const tabLevel = $('.lb-tab[data-tab="level"]');
    tabLevel.textContent = currentBoard[0] === 'L' ? boardLabel(currentBoard) : 'Level';
    if (!URL_) {
      body.innerHTML = `<div class="lb-empty">Online leaderboards aren't switched on yet.<br><small>Set <code>leaderboardUrl</code> in <code>js/config.js</code>.</small></div>`;
      return;
    }
    body.innerHTML = '<div class="lb-loading"><i></i><i></i><i></i></div>';
    const id = ++reqId;
    if (tab === 'top') {
      fetchTop().then((d) => { if (id === reqId) body.innerHTML = renderTop(d); }, (e) => { if (id === reqId) body.innerHTML = errorHtml(e); });
    } else {
      const board = tab === 'daily' ? dailyBoard : (currentBoard[0] === 'L' ? currentBoard : lastLevelBoard);
      fetchBoard(board).then((d) => { if (id === reqId) body.innerHTML = renderBoard(d); }, (e) => { if (id === reqId) body.innerHTML = errorHtml(e); });
    }
  }
  let lastLevelBoard = 'L1';

  function errorHtml(e) {
    return `<div class="lb-empty">Couldn't reach the leaderboard.<br><small>${esc(e.message || e)}</small></div>`;
  }

  function renderBoard(d) {
    if (!d.solvers) {
      return `<div class="lb-title">${esc(boardLabel(d.board))}</div>
        <div class="lb-empty">Nobody has solved this one yet.<br><b>Be the first!</b></div>`;
    }
    const maxCount = Math.max.apply(null, d.histogram.map((h) => h.count));
    const hist = d.histogram.map((h) => {
      const mine = d.me && d.me.moves === h.moves;
      const w = Math.max(4, Math.round((h.count / maxCount) * 100));
      return `<div class="hrow${mine ? ' mine' : ''}${d.par && h.moves <= d.par ? ' par' : ''}">
        <span class="hm">${h.moves}</span>
        <span class="hbar"><i style="width:${w}%"></i></span>
        <span class="hc">${h.count} ${h.count === 1 ? 'player' : 'players'}</span>
      </div>`;
    }).join('');
    const rows = d.top.slice();
    if (d.me && !rows.some((r) => r.you)) rows.push(Object.assign({ gap: true }, d.me));
    const table = rows.map((r) => `
      ${r.gap ? '<tr class="gap"><td colspan="5">⋯</td></tr>' : ''}
      <tr class="${r.you ? 'you' : ''}">
        <td class="rk">${r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : r.rank}</td>
        <td class="nm">${esc(r.name)}${r.you ? ' <em>you</em>' : ''}</td>
        <td>${r.moves}</td><td>${fmtTime(r.seconds)}</td><td class="sc">${r.score}</td>
      </tr>`).join('');
    return `
      <div class="lb-title">${esc(boardLabel(d.board))}</div>
      <div class="lb-stats">
        <div><span class="v">${d.solvers}</span><span class="k">Solved it</span></div>
        <div><span class="v">${d.fewest.moves}</span><span class="k">Fewest moves</span><small>${esc(d.fewest.name)}</small></div>
        <div><span class="v gold">${d.bestScore.score}</span><span class="k">Best score</span><small>${esc(d.bestScore.name)}</small></div>
      </div>
      <div class="lb-sub">Players by moves needed${d.par ? ` <span class="muted">· par ${d.par}</span>` : ''}</div>
      <div class="hist">${hist}</div>
      <div class="lb-sub">Top solvers</div>
      <table class="lb-table">
        <thead><tr><th>#</th><th>Name</th><th>Moves</th><th>Time</th><th>Score</th></tr></thead>
        <tbody>${table}</tbody>
      </table>`;
  }

  function renderTop(d) {
    if (!d.players) return '<div class="lb-empty">No scores yet. Win a level to claim the top spot!</div>';
    const rows = d.top.slice();
    if (d.me && !rows.some((r) => r.you)) rows.push(Object.assign({ gap: true }, d.me));
    return `
      <div class="lb-title">Top players <span class="muted">· ${d.players} total</span></div>
      <div class="lb-note">Total of each player's best score on every level and daily puzzle.</div>
      <table class="lb-table">
        <thead><tr><th>#</th><th>Name</th><th>Solved</th><th>Score</th></tr></thead>
        <tbody>${rows.map((r) => `
          ${r.gap ? '<tr class="gap"><td colspan="4">⋯</td></tr>' : ''}
          <tr class="${r.you ? 'you' : ''}">
            <td class="rk">${r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : r.rank}</td>
            <td class="nm">${esc(r.name)}${r.you ? ' <em>you</em>' : ''}</td>
            <td>${r.solved}</td><td class="sc">${r.score}</td>
          </tr>`).join('')}</tbody>
      </table>`;
  }

  // Summary line for the win card.
  function winSummary(d) {
    const me = d.me;
    const same = d.histogram.find((h) => h.moves === d.submitted.moves);
    const others = same ? same.count - (me && me.moves === d.submitted.moves ? 1 : 0) : 0;
    const bits = [];
    if (me) bits.push(`<b>#${me.rank}</b> of ${d.solvers}`);
    bits.push(others ? `${others} other${others === 1 ? '' : 's'} solved it in ${d.submitted.moves} moves` : `nobody else solved it in ${d.submitted.moves} moves`);
    let lead = '';
    if (me && me.rank === 1) lead = '👑 You hold the record! ';
    else if (d.fewest && d.fewest.moves < d.submitted.moves) lead = `Record: ${d.fewest.moves} moves by ${esc(d.fewest.name)}. `;
    return `${lead}${bits.join(' · ')}<br><span class="lb-score">Score ${d.submitted.score}</span>`;
  }

  // ---------- Wiring ----------
  document.querySelectorAll('.lb-tab').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; renderTab(); }));
  $('#lb-close').addEventListener('click', () => { $('#lb').hidden = true; });
  $('#lb').addEventListener('pointerdown', (e) => { if (e.target.id === 'lb') $('#lb').hidden = true; });
  const nameInput = $('#lb-name');
  nameInput.addEventListener('change', () => {
    const v = nameInput.value.replace(/[\u0000-\u001f<>"'`\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
    if (v) { player.name = v; store(PLAYER_KEY, player); }
    nameInput.value = player.name;
  });
  nameInput.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') nameInput.blur(); });

  if (URL_) setTimeout(flushPending, 2500);

  window.ColorSortLeaderboard = {
    enabled: !!URL_,
    player,
    submit,
    fetchBoard,
    fetchTop,
    winSummary,
    open(board, daily, which) { if (board[0] === 'L') lastLevelBoard = board; open(board, daily, which); },
    setLevelBoard(board) { lastLevelBoard = board; },
  };
})();
