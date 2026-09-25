/* Color Sort — game UI, animation, audio and progression. */
(function () {
  'use strict';

  const Core = window.ColorSortCore;
  const $ = (s) => document.querySelector(s);

  // ---------- Palette ----------
  const PALETTE = [
    { c: '#ff2a2a', sym: '●' },  // red
    { c: '#ff9a1a', sym: '▲' },  // orange
    { c: '#ffec1a', sym: '■' },  // yellow
    { c: '#22ff3a', sym: '◆' },  // green
    { c: '#19f0ff', sym: '★' },  // cyan
    { c: '#1e2cff', sym: '♥' },  // blue
    { c: '#8a90ff', sym: '✚' },  // periwinkle
    { c: '#8b1d9c', sym: '☾' },  // purple
    { c: '#ff1fe8', sym: '♣' },  // magenta
    { c: '#e6e6ea', sym: '♠' },  // white
    { c: '#ff8fb8', sym: '✦' },  // pink
    { c: '#a0602c', sym: '⬢' },  // brown
    { c: '#0e9e8c', sym: '✖' },  // teal
    { c: '#9aa815', sym: '◐' },  // olive
  ].map((p) => {
    const n = parseInt(p.c.slice(1), 16);
    return { c: p.c, sym: p.sym + '︎', rgb: `${n >> 16}, ${(n >> 8) & 255}, ${n & 255}` };
  });

  const HINT_COST = 15;
  const TUBE_COST = 40;
  const FREE_HINT_LEVELS = 3;
  const START_COINS = 100;
  const SAVE_KEY = 'colorsort.save.v1';
  const GAME_KEY = 'colorsort.game.v1';

  // ---------- Persistence ----------
  function loadJSON(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; } catch (e) { return fallback; }
  }
  function saveJSON(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }

  const save = Object.assign({
    level: 1,
    coins: START_COINS,
    stars: {},
    daily: { last: null, streak: 0, best: 0, done: {} },
    opts: { sound: true, haptics: true, symbols: false },
    seenHowto: false,
  }, loadJSON(SAVE_KEY, {}));
  save.opts = Object.assign({ sound: true, haptics: true, symbols: false }, save.opts);
  save.daily = Object.assign({ last: null, streak: 0, best: 0, done: {} }, save.daily);
  const persist = () => saveJSON(SAVE_KEY, save);

  function todayStr(d) {
    d = d || new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function yesterdayStr() { const d = new Date(); d.setDate(d.getDate() - 1); return todayStr(d); }

  // ---------- Audio ----------
  const Sound = (() => {
    let ctx = null, master = null;
    function ensure() {
      if (!save.opts.sound) return null;
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.55;
        const comp = ctx.createDynamicsCompressor();
        master.connect(comp); comp.connect(ctx.destination);
      }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    function tone(freq, dur, opts) {
      const c = ensure(); if (!c) return;
      opts = opts || {};
      const t = c.currentTime + (opts.delay || 0);
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = opts.type || 'sine';
      o.frequency.setValueAtTime(freq, t);
      if (opts.slide) o.frequency.exponentialRampToValueAtTime(opts.slide, t + dur);
      const v = opts.vol == null ? 0.25 : opts.vol;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(v, t + (opts.attack || 0.008));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + dur + 0.05);
    }
    const note = (n) => 440 * Math.pow(2, (n - 69) / 12);
    return {
      unlock: ensure,
      select() { tone(880, 0.09, { type: 'triangle', vol: 0.16, slide: 1180 }); },
      deselect() { tone(700, 0.08, { type: 'triangle', vol: 0.1, slide: 520 }); },
      pour(count, startFill, cap) {
        for (let i = 0; i < count; i++) {
          const fill = (startFill + i) / cap;
          const f = 420 * Math.pow(2, fill * 1.2);
          tone(f, 0.16, { type: 'sine', vol: 0.22, delay: 0.09 + i * 0.07, slide: f * 1.04 });
          tone(f * 2, 0.08, { type: 'triangle', vol: 0.05, delay: 0.09 + i * 0.07 });
        }
      },
      error() { tone(160, 0.14, { type: 'square', vol: 0.06, slide: 110 }); },
      complete(streak) {
        const base = 72 + Math.min(streak, 8) * 2;
        [0, 4, 7, 12].forEach((s, i) => tone(note(base + s), 0.35, { type: 'triangle', vol: 0.16, delay: i * 0.06 }));
        tone(note(base + 24), 0.5, { type: 'sine', vol: 0.08, delay: 0.24 });
      },
      reveal() { tone(1320, 0.12, { type: 'sine', vol: 0.08, slide: 1760 }); },
      hint() { [0, 5, 9].forEach((s, i) => tone(note(84 + s), 0.2, { type: 'sine', vol: 0.1, delay: i * 0.05 })); },
      coin() { tone(1568, 0.08, { type: 'square', vol: 0.05 }); tone(2093, 0.18, { type: 'square', vol: 0.05, delay: 0.07 }); },
      undo() { tone(600, 0.1, { type: 'triangle', vol: 0.1, slide: 400 }); },
      win() {
        const seq = [60, 64, 67, 72, 76, 79, 84];
        seq.forEach((n, i) => tone(note(n), 0.3, { type: 'triangle', vol: 0.15, delay: i * 0.075 }));
        [72, 76, 79, 84].forEach((n) => tone(note(n), 1.2, { type: 'sine', vol: 0.07, delay: 0.55 }));
      },
    };
  })();

  function buzz(p) {
    if (!save.opts.haptics || !navigator.vibrate) return;
    try { navigator.vibrate(p); } catch (e) { /* ignore */ }
  }

  // ---------- FX (particles / confetti) ----------
  const FX = (() => {
    const cv = $('#fx');
    const ctx = cv.getContext('2d');
    let parts = [], running = false, dpr = 1;
    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
    }
    resize();
    addEventListener('resize', resize);
    function loop() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      parts = parts.filter((p) => p.life > 0);
      for (const p of parts) {
        p.vy += p.g; p.vx *= p.drag; p.vy *= p.drag;
        p.x += p.vx; p.y += p.vy; p.life--; p.rot += p.vr;
        const a = Math.min(1, p.life / 25);
        ctx.globalAlpha = a;
        if (p.kind === 'conf') {
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2 * (0.4 + Math.abs(Math.sin(p.rot * 2))));
          ctx.restore();
        } else {
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = p.color;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.4 + a * 0.6), 0, Math.PI * 2); ctx.fill();
          ctx.globalCompositeOperation = 'source-over';
        }
      }
      ctx.globalAlpha = 1;
      if (parts.length) requestAnimationFrame(loop); else { running = false; ctx.clearRect(0, 0, innerWidth, innerHeight); }
    }
    function kick() { if (!running) { running = true; requestAnimationFrame(loop); } }
    return {
      burst(x, y, color, n) {
        n = n || 36;
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 6;
          parts.push({ kind: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 2, g: 0.12, drag: 0.96,
            life: 40 + Math.random() * 30, size: 2 + Math.random() * 3, color, rot: 0, vr: 0 });
        }
        kick();
      },
      confetti() {
        const colors = PALETTE.map((p) => p.c);
        for (let i = 0; i < 160; i++) {
          const fromLeft = i % 2 === 0;
          parts.push({ kind: 'conf', x: fromLeft ? -10 : innerWidth + 10, y: innerHeight * (0.55 + Math.random() * 0.3),
            vx: (fromLeft ? 1 : -1) * (6 + Math.random() * 9), vy: -(9 + Math.random() * 11), g: 0.28, drag: 0.985,
            life: 120 + Math.random() * 80, size: 8 + Math.random() * 8, color: colors[i % colors.length],
            rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4 });
        }
        kick();
      },
    };
  })();

  function floatText(x, y, text, color) {
    const el = document.createElement('div');
    el.className = 'float-text';
    el.textContent = text;
    el.style.left = x + 'px'; el.style.top = y + 'px'; el.style.color = color;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1200);
  }

  let toastTimer = 0;
  function toast(msg, ms) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms || 2200);
  }

  // ---------- Game state ----------
  let G = null;           // current game
  let tubeEls = [];       // DOM refs per tube
  let dims = null;        // layout metrics
  let hintTimer = 0;

  function newGame(mode, id) {
    const cfg = mode === 'daily' ? Core.dailyConfig(id) : Core.levelConfig(id);
    const lv = Core.generate(cfg);
    const tubes = lv.tubes.map((t) => t.slice()); // includes the empty tubes
    const hidden = tubes.map((t) => t.map((_, i) => cfg.mystery && i < t.length - 1));
    G = {
      mode, id, cap: lv.capacity, par: lv.par, mystery: cfg.mystery,
      tubes, hidden, start: { tubes: tubes.map((t) => t.slice()), hidden: hidden.map((h) => h.slice()) },
      history: [], moves: 0, selected: -1, extra: 0, hints: 0, completedCount: 0, won: false,
    };
    persistGame();
    render(true);
    updateHud();
    if (mode === 'campaign' && id === 1 && !save.stars[1]) {
      if (save.seenHowto) setTimeout(() => toast('Tap a tube to pick up its top color, then tap where to pour it', 4200), 700);
    } else if (G.mystery) {
      setTimeout(() => toast('Mystery level: hidden colors reveal as you dig ❓', 2800), 500);
    } else if (mode === 'daily') {
      setTimeout(() => toast('Daily Challenge — keep your streak alive 🔥', 2600), 500);
    }
  }

  function persistGame() {
    if (!G) return;
    saveJSON(GAME_KEY, {
      mode: G.mode, id: G.id, cap: G.cap, par: G.par, mystery: G.mystery,
      tubes: G.tubes, hidden: G.hidden, start: G.start, history: G.history.slice(-300),
      moves: G.moves, extra: G.extra, hints: G.hints, completedCount: G.completedCount, won: G.won,
    });
  }

  function restoreGame() {
    const g = loadJSON(GAME_KEY, null);
    if (!g || !g.tubes || g.won) return false;
    if (g.mode === 'daily' && g.id !== todayStr()) return false;
    if (g.mode === 'campaign' && g.id !== save.level) return false;
    G = Object.assign({ selected: -1 }, g);
    render(true);
    updateHud();
    return true;
  }

  // Top run length counting only revealed blocks.
  function runLen(i) {
    const t = G.tubes[i], h = G.hidden[i];
    const n = t.length;
    if (!n || h[n - 1]) return 0;
    let k = 1;
    while (k < n && t[n - 1 - k] === t[n - 1] && !h[n - 1 - k]) k++;
    return k;
  }
  function pourAmount(a, b) {
    if (a === b) return 0;
    const A = G.tubes[a], B = G.tubes[b];
    if (!A.length || B.length >= G.cap) return 0;
    if (B.length && B[B.length - 1] !== A[A.length - 1]) return 0;
    return Math.min(runLen(a), G.cap - B.length);
  }
  const tubeDone = (i) => G.tubes[i].length === G.cap && Core.isSolvedTube(G.tubes[i], G.cap);
  function isWon() { return G.tubes.every((t) => Core.isSolvedTube(t, G.cap)); }
  function anyMove() {
    for (let a = 0; a < G.tubes.length; a++) {
      if (tubeDone(a)) continue;
      for (let b = 0; b < G.tubes.length; b++) if (pourAmount(a, b)) return true;
    }
    return false;
  }

  function starThresholds() {
    const three = G.par + 2;
    const two = Math.ceil(G.par * 1.3) + 3;
    return { three, two };
  }
  function starsFor(moves) {
    const t = starThresholds();
    return moves <= t.three ? 3 : moves <= t.two ? 2 : 1;
  }

  // ---------- Layout & rendering ----------
  function computeLayout() {
    const wrap = $('#board-wrap');
    const W = wrap.clientWidth - 8, H = wrap.clientHeight - 8;
    const n = G.tubes.length, cap = G.cap;
    // Everything measured in units of the slot height s.
    const gapU = 0.14, padU = 0.26, blockWU = 2.05;
    const tubeWU = blockWU + padU * 2;
    const tubeHU = cap + (cap - 1) * gapU + padU * 2;
    const liftU = 1.0;          // room above each tube for lifted blocks
    const colGapU = 0.42, rowGapU = 0.35, keyU = 0.3;
    let best = null;
    for (let rows = 1; rows <= n; rows++) {
      const cols = Math.ceil(n / rows);
      if (Math.ceil(n / cols) !== rows) continue;
      const sW = W / (cols * tubeWU + (cols - 1) * colGapU);
      const sH = H / (rows * (tubeHU + liftU + keyU) + (rows - 1) * rowGapU);
      const s = Math.min(sW, sH);
      if (!best || s > best.s + 0.5) best = { s, rows, cols };
    }
    const s = Math.max(14, Math.min(best.s, 64));
    return {
      s, rows: best.rows, cols: best.cols,
      slot: s, gap: s * gapU, pad: s * padU,
      tw: s * tubeWU, th: s * tubeHU, liftRoom: s * liftU,
      colGap: s * colGapU, rowGap: s * (rowGapU + keyU),
    };
  }

  function blockEl(color, i, hidden) {
    const el = document.createElement('div');
    el.className = 'block' + (hidden ? ' hidden' : '');
    el.style.setProperty('--i', i);
    const sym = document.createElement('span');
    sym.className = 'sym';
    el.appendChild(sym);
    setBlockColor(el, color, hidden);
    return el;
  }
  function setBlockColor(el, color, hidden) {
    const p = PALETTE[color];
    if (hidden) { el.style.setProperty('--c', '#222'); el.style.setProperty('--rgb', '0,0,0'); }
    else { el.style.setProperty('--c', p.c); el.style.setProperty('--rgb', p.rgb); }
    const sym = el.querySelector('.sym');
    if (sym) sym.textContent = hidden ? '' : p.sym;
  }

  function render(enter) {
    const board = $('#board');
    dims = computeLayout();
    board.style.setProperty('--slot', dims.slot + 'px');
    board.style.setProperty('--gap', dims.gap + 'px');
    board.style.setProperty('--pad', dims.pad + 'px');
    board.style.setProperty('--tw', dims.tw + 'px');
    board.style.setProperty('--th', dims.th + 'px');
    board.style.setProperty('--lift-room', dims.liftRoom + 'px');
    board.style.setProperty('--col-gap', dims.colGap + 'px');
    board.style.setProperty('--row-gap', dims.rowGap + 'px');
    board.innerHTML = '';
    board.classList.toggle('enter', !!enter);
    tubeEls = [];
    const n = G.tubes.length;
    // Balanced rows: distribute as evenly as possible, larger rows first.
    const base = Math.floor(n / dims.rows), extra = n % dims.rows;
    let k = 0;
    for (let r = 0; r < dims.rows; r++) {
      const row = document.createElement('div');
      row.className = 'brow';
      const count = base + (r < extra ? 1 : 0);
      for (let c = 0; c < count; c++, k++) row.appendChild(buildTube(k));
      board.appendChild(row);
    }
    if (enter) setTimeout(() => board.classList.remove('enter'), 1200);
    if (G.selected >= 0) liftSelected(G.selected, true);
  }

  function buildTube(i) {
    const el = document.createElement('div');
    el.className = 'tube' + (i >= G.tubes.length - G.extra ? ' extra' : '');
    el.style.setProperty('--k', i);
    el.dataset.i = i;
    for (let s = 0; s < G.cap; s++) {
      const slot = document.createElement('div');
      slot.className = 'slot';
      slot.style.setProperty('--i', s);
      el.appendChild(slot);
    }
    const cap = document.createElement('div');
    cap.className = 'cap';
    el.appendChild(cap);
    G.tubes[i].forEach((c, j) => el.appendChild(blockEl(c, j, G.hidden[i][j])));
    if (i < 10 && matchMedia('(hover: hover)').matches) {
      const key = document.createElement('div');
      key.className = 'key';
      key.textContent = (i + 1) % 10;
      el.appendChild(key);
    }
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); onTube(i); });
    tubeEls[i] = el;
    markDone(i, false);
    return el;
  }

  function blocksOf(i) {
    return Array.from(tubeEls[i].querySelectorAll('.block'))
      .sort((x, y) => +x.style.getPropertyValue('--i') - +y.style.getPropertyValue('--i'));
  }

  function liftPx(i) {
    // Raise the run so its top block floats just above the rim.
    const len = G.tubes[i].length;
    return (G.cap - len) * (dims.slot + dims.gap) + dims.slot * 0.62 + dims.pad;
  }

  function liftSelected(i, on) {
    const blocks = blocksOf(i);
    const run = runLen(i);
    tubeEls[i].style.setProperty('--lift', liftPx(i) + 'px');
    tubeEls[i].classList.toggle('selected', on);
    blocks.forEach((b, j) => b.classList.toggle('lifted', on && j >= blocks.length - run));
  }

  function markDone(i, celebrate) {
    const el = tubeEls[i];
    const done = tubeDone(i);
    const wasDone = el.classList.contains('done');
    el.classList.toggle('done', done);
    if (done) el.style.setProperty('--rgb', PALETTE[G.tubes[i][0]].rgb);
    if (done && celebrate && !wasDone) {
      el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
      const r = el.getBoundingClientRect();
      const color = PALETTE[G.tubes[i][0]].c;
      FX.burst(r.left + r.width / 2, r.top + 6, color, 44);
      G.completedCount++;
      const words = ['Nice!', 'Great!', 'Sweet!', 'Awesome!', 'Brilliant!', 'Amazing!', 'Unstoppable!', 'Legendary!'];
      floatText(r.left + r.width / 2, r.top - 8, words[Math.min(G.completedCount - 1, words.length - 1)], color);
      Sound.complete(G.completedCount);
      buzz([20, 40, 30]);
    }
  }

  // ---------- Interaction ----------
  function clearHint() {
    clearTimeout(hintTimer);
    tubeEls.forEach((el) => el && el.classList.remove('hint-from', 'hint-to'));
  }

  function onTube(i) {
    Sound.unlock();
    if (!G || G.won) return;
    clearHint();
    const sel = G.selected;
    if (sel < 0) {
      if (!G.tubes[i].length || tubeDone(i)) { shake(i); return; }
      G.selected = i;
      liftSelected(i, true);
      Sound.select(); buzz(8);
      return;
    }
    if (sel === i) {
      G.selected = -1;
      liftSelected(i, false);
      Sound.deselect();
      return;
    }
    const n = pourAmount(sel, i);
    if (!n) {
      // An impossible pour shakes the target; if it holds blocks, it becomes the new selection.
      shake(i);
      Sound.error(); buzz(30);
      if (G.tubes[i].length && !tubeDone(i)) {
        liftSelected(sel, false);
        G.selected = i;
        liftSelected(i, true);
      }
      return;
    }
    G.selected = -1;
    tubeEls[sel].classList.remove('selected');
    doPour(sel, i, n, true);
  }

  function shake(i) {
    const el = tubeEls[i];
    el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
  }

  // Moves n blocks from a to b with a FLIP arc animation. Records history unless undoing.
  function doPour(a, b, n, record) {
    const src = blocksOf(a);
    const moving = src.slice(src.length - n);
    const staying = src.slice(0, src.length - n);
    const firsts = moving.map((el) => el.getBoundingClientRect());
    const startFill = G.tubes[b].length;

    for (let k = 0; k < n; k++) {
      G.tubes[b].push(G.tubes[a].pop());
      G.hidden[b].push(G.hidden[a].pop());
    }
    // Moved blocks keep their visual order: the topmost source block lands on top.
    const reveals = [];
    if (record) {
      const t = G.hidden[a];
      if (t.length && t[t.length - 1]) { t[t.length - 1] = false; reveals.push(t.length - 1); }
      G.history.push({ a, b, n, reveals });
      G.moves++;
    }

    const dst = tubeEls[b];
    const rimTop = dst.getBoundingClientRect().top;
    moving.forEach((el, k) => {
      el.getAnimations().forEach((an) => an.cancel());
      el.style.transition = 'none';
      el.classList.remove('lifted');
      el.classList.add('flying');
      el.style.setProperty('--i', startFill + k);
      dst.appendChild(el);
    });
    moving.forEach((el, k) => {
      const last = el.getBoundingClientRect();
      const dx = firsts[k].left - last.left, dy = firsts[k].top - last.top;
      // Arc: rise above both rims, drift over the target, then drop in.
      const peakTop = Math.min(firsts[k].top - dims.slot * 0.3, rimTop - dims.slot * 1.15 - k * (dims.slot + dims.gap));
      const anim = el.animate([
        { transform: `translate(${dx}px, ${dy}px)` },
        { transform: `translate(${dx * 0.12}px, ${peakTop - last.top}px)`, offset: 0.55 },
        { transform: 'translate(0, 0)' },
      ], { duration: 430, delay: (n - 1 - k) * 45, easing: 'cubic-bezier(.35,.1,.25,1)', fill: 'backwards' });
      anim.onfinish = anim.oncancel = () => { el.classList.remove('flying'); el.style.transition = ''; };
    });
    staying.forEach((el) => el.classList.remove('lifted'));
    tubeEls[a].classList.remove('selected');

    // Reveal the new top of the source after a pour.
    const srcBlocks = blocksOf(a);
    if (record && reveals.length) {
      const top = srcBlocks[srcBlocks.length - 1];
      const c = G.tubes[a][G.tubes[a].length - 1];
      setTimeout(() => {
        // Skip if an undo/restart already changed this block.
        const idx = +top.style.getPropertyValue('--i');
        if (top.parentNode !== tubeEls[a] || G.hidden[a][idx] || G.tubes[a][idx] !== c) return;
        top.classList.remove('hidden');
        setBlockColor(top, c, false);
        top.classList.remove('reveal'); void top.offsetWidth; top.classList.add('reveal');
        Sound.reveal();
      }, 180);
    }
    if (record) { Sound.pour(n, startFill, G.cap); buzz(12); } else Sound.undo();

    markDone(a, false);
    const delay = 430 + (n - 1) * 45;
    if (record) setTimeout(() => markDone(b, true), delay - 80);
    else markDone(b, false);

    persistGame();
    updateHud();

    if (record) {
      if (isWon()) {
        G.won = true;
        persistGame();
        setTimeout(onWin, delay + 350);
      } else if (!anyMove()) {
        setTimeout(() => { if (G && !G.won && !anyMove()) show('#stuck'); }, delay + 250);
      }
    }
  }

  function undo() {
    if (!G || G.won || !G.history.length) { if (G && !G.won) toast('Nothing to undo'); return; }
    clearHint();
    if (G.selected >= 0) { liftSelected(G.selected, false); G.selected = -1; }
    const m = G.history.pop();
    G.moves = Math.max(0, G.moves - 1);
    // Re-hide the block this move revealed (it sits on top of tube a).
    const rehideA = m.reveals.slice();
    doPour(m.b, m.a, m.n, false);
    if (rehideA.length) {
      rehideA.forEach((idx) => { G.hidden[m.a][idx] = true; });
      const blocks = blocksOf(m.a);
      rehideA.forEach((idx) => { const el = blocks[idx]; if (el) { el.classList.add('hidden'); setBlockColor(el, G.tubes[m.a][idx], true); } });
      persistGame();
    }
    buzz(8);
  }

  function restart() {
    if (!G) return;
    clearHint();
    G.tubes = G.start.tubes.map((t) => t.slice());
    G.hidden = G.start.hidden.map((h) => h.slice());
    for (let e = 0; e < G.extra; e++) { G.tubes.push([]); G.hidden.push([]); }
    G.history = []; G.moves = 0; G.selected = -1; G.completedCount = 0; G.won = false;
    persistGame();
    render(true);
    updateHud();
    Sound.undo();
  }

  function hintCost() { return G.mode === 'campaign' && G.id <= FREE_HINT_LEVELS ? 0 : HINT_COST; }

  function hint() {
    if (!G || G.won) return;
    const cost = hintCost();
    if (save.coins < cost) { toast(`Hints cost ${cost} coins — win levels to earn more`); Sound.error(); return; }
    if (G.selected >= 0) { liftSelected(G.selected, false); G.selected = -1; }
    const sol = Core.solve(G.tubes.map((t) => t.slice()), G.cap, { maxNodes: 120000, weight: 1.5 });
    if (!sol) { toast('No way out from here — try Undo ↩︎'); Sound.error(); return; }
    if (!sol.length) return;
    let [a, b] = sol[0];
    // In mystery mode the visible run may be shorter; the hinted move is still legal.
    if (!pourAmount(a, b)) {
      toast('No way out from here — try Undo ↩︎'); Sound.error(); return;
    }
    if (cost) { save.coins -= cost; persist(); }
    G.hints++;
    clearHint();
    tubeEls[a].classList.add('hint-from');
    tubeEls[b].classList.add('hint-to');
    hintTimer = setTimeout(clearHint, 4000);
    Sound.hint();
    updateHud();
  }

  function addTube() {
    if (!G || G.won) return;
    if (G.extra >= 1) { toast('Only one extra tube per level'); Sound.error(); return; }
    if (save.coins < TUBE_COST) { toast(`An extra tube costs ${TUBE_COST} coins`); Sound.error(); return; }
    save.coins -= TUBE_COST; persist();
    G.extra++;
    G.tubes.push([]); G.hidden.push([]);
    G.selected = -1;
    persistGame();
    render(false);
    const el = tubeEls[tubeEls.length - 1];
    el.classList.add('pop');
    const r = el.getBoundingClientRect();
    FX.burst(r.left + r.width / 2, r.top + r.height / 2, '#b9a6ff', 30);
    Sound.hint();
    hide('#stuck');
    updateHud();
  }

  // ---------- Win ----------
  function onWin() {
    const stars = starsFor(G.moves);
    let coins = 10 + stars * 5;
    let note = '';
    if (G.moves < G.par) note = `Under par by ${G.par - G.moves}! Genius 🧠`;
    else if (G.moves === G.par) note = 'Matched the solver. Perfect! 🎯';
    if (G.mode === 'campaign') {
      const prev = save.stars[G.id] || 0;
      if (prev) coins = Math.max(3, Math.round(coins / 3)); // replays pay less
      save.stars[G.id] = Math.max(prev, stars);
      if (G.id === save.level) save.level++;
    } else {
      const today = todayStr();
      if (!save.daily.done[today]) {
        save.daily.streak = save.daily.last === yesterdayStr() ? save.daily.streak + 1 : (save.daily.last === today ? save.daily.streak : 1);
        save.daily.best = Math.max(save.daily.best, save.daily.streak);
        save.daily.last = today;
        save.daily.done[today] = stars;
        coins += 40 + Math.min(save.daily.streak, 10) * 5;
        note = `🔥 ${save.daily.streak}-day streak! ${note}`;
      } else {
        coins = 5;
      }
    }
    save.coins += coins;
    persist();
    saveJSON(GAME_KEY, null);

    const titles = ['Sorted!', 'Nice!', 'Great!', 'Flawless!'];
    $('#win-title').textContent = G.mode === 'daily' ? 'Daily done!' : titles[stars];
    $('#win-moves').textContent = G.moves;
    $('#win-par').textContent = G.par;
    $('#win-coins').textContent = '+' + coins;
    $('#win-note').textContent = note;
    $('#btn-next').textContent = G.mode === 'daily' ? 'Back to Campaign' : `Level ${G.id + 1} →`;
    $('#btn-replay').hidden = G.mode === 'daily';
    const bs = document.querySelectorAll('#win-stars .bs');
    bs.forEach((s) => s.classList.remove('on'));
    show('#win');
    Sound.win(); buzz([30, 60, 30, 60, 80]);
    FX.confetti();
    bs.forEach((s, i) => { if (i < stars) setTimeout(() => { s.classList.add('on'); Sound.coin(); }, 350 + i * 260); });
    animateCoins(save.coins - coins, save.coins);
  }

  function animateCoins(from, to) {
    const el = $('#coin-count');
    const start = performance.now(), dur = 900;
    const step = (t) => {
      const p = Math.min(1, (t - start) / dur);
      el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    const c = $('#coins'); c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump');
  }

  // ---------- HUD ----------
  function updateHud() {
    if (!G) return;
    $('#mode-label').textContent = G.mode === 'daily' ? 'DAILY' : 'LEVEL';
    $('#level-num').textContent = G.mode === 'daily' ? G.id.slice(5).replace('-', '/') : G.id;
    $('#moves').textContent = G.moves;
    $('#coin-count').textContent = save.coins;
    const stars = starsFor(G.moves);
    const t = starThresholds();
    const nextLimit = stars === 3 ? t.three : stars === 2 ? t.two : null;
    $('#par-info').innerHTML =
      `<span class="mini">${[1, 2, 3].map((k) => `<i class="${k <= stars ? '' : 'off'}"></i>`).join('')}</span>` +
      `<span>${nextLimit != null ? `${nextLimit - G.moves} moves left` : 'Finish it!'}</span>`;
    const tag = $('#level-tag');
    const tags = [];
    if (G.mystery) tags.push('Mystery');
    if (G.mode === 'campaign' && G.id > 10 && G.id % 7 === 0) tags.push('Breather');
    if (G.cap === 5) tags.push('Tall tubes');
    tag.hidden = !tags.length;
    tag.textContent = tags.join(' · ');
    const hc = hintCost();
    const hb = $('#hint-cost');
    hb.textContent = hc ? hc : 'FREE';
    hb.classList.toggle('free', !hc);
    $('#tube-cost').textContent = G.extra ? '✓' : TUBE_COST;
    $('#btn-tube').disabled = G.extra >= 1;
    $('#btn-undo').disabled = !G.history.length;
  }

  function updateMenu() {
    const totalStars = Object.values(save.stars).reduce((a, b) => a + b, 0);
    $('#st-level').textContent = save.level;
    $('#st-stars').textContent = totalStars;
    const streak = save.daily.last === todayStr() || save.daily.last === yesterdayStr() ? save.daily.streak : 0;
    $('#st-streak').textContent = streak;
    const doneToday = save.daily.done[todayStr()];
    $('#daily-sub').textContent = doneToday ? `Done today ${'★'.repeat(doneToday)} · come back tomorrow` : (streak ? `Keep your ${streak}-day streak alive 🔥` : 'A fresh hard puzzle every day');
    $('#campaign-sub').textContent = `Continue at level ${save.level}`;
    $('#opt-sound').checked = save.opts.sound;
    $('#opt-haptics').checked = save.opts.haptics;
    $('#opt-symbols').checked = save.opts.symbols;
  }

  function show(sel) { $(sel).hidden = false; }
  function hide(sel) { $(sel).hidden = true; }
  const anyOverlay = () => Array.from(document.querySelectorAll('.overlay')).some((o) => !o.hidden);

  // ---------- Wiring ----------
  $('#btn-undo').addEventListener('click', undo);
  $('#btn-restart').addEventListener('click', restart);
  $('#btn-hint').addEventListener('click', hint);
  $('#btn-tube').addEventListener('click', addTube);
  $('#btn-next').addEventListener('click', () => {
    hide('#win');
    newGame('campaign', save.level);
  });
  $('#btn-replay').addEventListener('click', () => {
    hide('#win');
    newGame(G.mode, G.id);
  });
  $('#stuck-undo').addEventListener('click', () => { hide('#stuck'); undo(); });
  $('#stuck-tube').addEventListener('click', () => { hide('#stuck'); addTube(); });
  $('#stuck-restart').addEventListener('click', () => { hide('#stuck'); restart(); });

  $('#btn-menu').addEventListener('click', () => { updateMenu(); show('#menu'); });
  $('#menu-close').addEventListener('click', () => hide('#menu'));
  $('#btn-daily').addEventListener('click', () => {
    hide('#menu');
    const today = todayStr();
    if (G && G.mode === 'daily' && G.id === today && !G.won) return;
    newGame('daily', today);
  });
  $('#btn-campaign').addEventListener('click', () => {
    hide('#menu');
    if (G && G.mode === 'campaign' && G.id === save.level && !G.won) return;
    newGame('campaign', save.level);
  });
  $('#btn-howto').addEventListener('click', () => { hide('#menu'); show('#howto'); });
  $('#howto-close').addEventListener('click', () => {
    hide('#howto');
    if (!save.seenHowto && G && G.mode === 'campaign' && G.id === 1 && !G.moves) {
      setTimeout(() => toast('Tap a tube to pick up its top color, then tap where to pour it', 4200), 300);
    }
    save.seenHowto = true; persist();
  });
  $('#btn-reset').addEventListener('click', () => {
    if (!confirm('Reset all progress, coins and streaks?')) return;
    try { localStorage.removeItem(SAVE_KEY); localStorage.removeItem(GAME_KEY); } catch (e) { /* ignore */ }
    location.reload();
  });
  const bindOpt = (id, key, after) => $(id).addEventListener('change', (e) => {
    save.opts[key] = e.target.checked; persist(); if (after) after();
  });
  bindOpt('#opt-sound', 'sound', () => Sound.select());
  bindOpt('#opt-haptics', 'haptics', () => buzz(20));
  bindOpt('#opt-symbols', 'symbols', () => document.body.classList.toggle('symbols', save.opts.symbols));

  document.querySelectorAll('.overlay').forEach((o) => o.addEventListener('pointerdown', (e) => {
    if (e.target === o && (o.id === 'menu' || o.id === 'howto')) hide('#' + o.id);
  }));

  addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Escape') { ['#menu', '#howto', '#stuck'].forEach(hide); return; }
    if (anyOverlay()) {
      if (e.key === 'Enter' && !$('#win').hidden) $('#btn-next').click();
      return;
    }
    if (/^[0-9]$/.test(e.key)) {
      const i = e.key === '0' ? 9 : +e.key - 1;
      if (G && i < G.tubes.length) onTube(i);
    } else if (e.key === 'z' || e.key === 'u' || e.key === 'Backspace') undo();
    else if (e.key === 'r') restart();
    else if (e.key === 'h') hint();
  });

  let resizeTimer = 0;
  addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (G) render(false); }, 120);
  });

  // ---------- Boot ----------
  document.body.classList.toggle('symbols', save.opts.symbols);
  persist();
  if (!restoreGame()) newGame('campaign', save.level);
  if (!save.seenHowto) show('#howto');

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  // Exposed for debugging / automated checks.
  window.__colorsort = { get game() { return G; }, onTube, undo, restart, hint, addTube, newGame, save };
})();
