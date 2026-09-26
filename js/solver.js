/*
 * Color Sort — puzzle core: seeded RNG, level generation and a weighted A* solver.
 * Works in the browser (window.ColorSortCore) and in Node (module.exports) for tests.
 *
 * A state is an array of tubes; each tube is an array of color ids (0-based),
 * bottom first. Tube capacity is shared by every tube in a level.
 */
(function (root) {
  'use strict';

  // ---------- RNG ----------
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashString(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function shuffle(arr, rand) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  // ---------- Rules ----------
  function topRun(tube) {
    const n = tube.length;
    if (!n) return 0;
    const c = tube[n - 1];
    let k = 1;
    while (k < n && tube[n - 1 - k] === c) k++;
    return k;
  }

  // How many blocks would move from tube a to tube b (0 = illegal).
  function pourAmount(state, a, b, cap) {
    if (a === b) return 0;
    const A = state[a], B = state[b];
    if (!A.length || B.length >= cap) return 0;
    if (B.length && B[B.length - 1] !== A[A.length - 1]) return 0;
    return Math.min(topRun(A), cap - B.length);
  }

  function isSolvedTube(tube, cap) {
    if (tube.length === 0) return true;
    if (tube.length !== cap) return false;
    for (let i = 1; i < tube.length; i++) if (tube[i] !== tube[0]) return false;
    return true;
  }

  function isSolved(state, cap) {
    for (let i = 0; i < state.length; i++) if (!isSolvedTube(state[i], cap)) return false;
    return true;
  }

  function hasAnyMove(state, cap) {
    for (let a = 0; a < state.length; a++) {
      if (!state[a].length || isSolvedTube(state[a], cap)) continue;
      for (let b = 0; b < state.length; b++) {
        if (pourAmount(state, a, b, cap)) return true;
      }
    }
    return false;
  }

  // ---------- Solver ----------
  const CH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

  function tubeKey(t) {
    let s = '';
    for (let i = 0; i < t.length; i++) s += CH[t[i]];
    return s;
  }

  function canonicalKey(state) {
    const parts = state.map(tubeKey);
    parts.sort();
    return parts.join('|');
  }

  // Admissible lower bound: every run above a tube's bottom run must move once,
  // and for each color, all but one of the tubes having it at the bottom must be emptied.
  function heuristic(state) {
    let h = 0;
    const bottoms = {};
    for (let i = 0; i < state.length; i++) {
      const t = state[i];
      if (!t.length) continue;
      for (let j = 1; j < t.length; j++) if (t[j] !== t[j - 1]) h++;
      bottoms[t[0]] = (bottoms[t[0]] || 0) + 1;
    }
    for (const c in bottoms) h += bottoms[c] - 1;
    return h;
  }

  function MinHeap() { this.a = []; }
  MinHeap.prototype.push = function (node) {
    const a = this.a; a.push(node);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= node.f) break;
      a[i] = a[p]; i = p;
    }
    a[i] = node;
  };
  MinHeap.prototype.pop = function () {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      let i = 0;
      const n = a.length;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i, mf = last.f;
        if (l < n && a[l].f < mf) { m = l; mf = a[l].f; }
        if (r < n && a[r].f < mf) { m = r; }
        if (m === i) break;
        a[i] = a[m]; i = m;
      }
      a[i] = last;
    }
    return top;
  };
  Object.defineProperty(MinHeap.prototype, 'size', { get: function () { return this.a.length; } });

  function generateMoves(state, cap) {
    const moves = [];
    let firstEmpty = -1;
    for (let b = 0; b < state.length; b++) if (!state[b].length) { firstEmpty = b; break; }
    for (let a = 0; a < state.length; a++) {
      const A = state[a];
      if (!A.length || isSolvedTube(A, cap)) continue;
      const run = topRun(A);
      for (let b = 0; b < state.length; b++) {
        if (a === b) continue;
        const B = state[b];
        if (!B.length) {
          if (b !== firstEmpty) continue;         // empty tubes are interchangeable
          if (run === A.length) continue;          // moving a uniform tube into an empty one is pointless
        }
        const n = pourAmount(state, a, b, cap);
        if (!n) continue;
        moves.push([a, b, n]);
      }
    }
    return moves;
  }

  function applyMove(state, a, b, n) {
    const next = state.slice();
    const A = state[a].slice(), B = state[b].slice();
    for (let i = 0; i < n; i++) B.push(A.pop());
    next[a] = A; next[b] = B;
    return next;
  }

  /**
   * Returns an array of [from, to] moves solving the puzzle, or null if none was
   * found within the node budget. `weight` > 1 trades optimality for speed.
   */
  function solve(start, cap, opts) {
    opts = opts || {};
    const maxNodes = opts.maxNodes || 250000;
    const weight = opts.weight || 1.6;
    if (isSolved(start, cap)) return [];
    const seen = new Map();
    const heap = new MinHeap();
    const h0 = heuristic(start);
    heap.push({ s: start, g: 0, f: h0 * weight, parent: null, move: null });
    seen.set(canonicalKey(start), 0);
    let expanded = 0;
    while (heap.size) {
      const node = heap.pop();
      if (++expanded > maxNodes) return null;
      const moves = generateMoves(node.s, cap);
      for (let i = 0; i < moves.length; i++) {
        const m = moves[i];
        const s = applyMove(node.s, m[0], m[1], m[2]);
        const g = node.g + 1;
        const key = canonicalKey(s);
        const prev = seen.get(key);
        if (prev !== undefined && prev <= g) continue;
        seen.set(key, g);
        const child = { s: s, g: g, f: g + heuristic(s) * weight, parent: node, move: [m[0], m[1]] };
        if (isSolved(s, cap)) {
          const path = [];
          for (let n = child; n.parent; n = n.parent) path.push(n.move);
          return path.reverse();
        }
        heap.push(child);
      }
    }
    return null;
  }

  // ---------- Level design ----------
  const PALETTE_SIZE = 12;

  // Difficulty curve for the endless campaign.
  function levelConfig(level) {
    const L = Math.max(1, level | 0);
    let colors;
    if (L <= 1) colors = 3;
    else if (L <= 3) colors = 4;
    else if (L <= 6) colors = 5;
    else if (L <= 10) colors = 6;
    else if (L <= 15) colors = 7;
    else if (L <= 21) colors = 8;
    else if (L <= 28) colors = 9;
    else if (L <= 38) colors = 10;
    else if (L <= 50) colors = 11;
    else colors = 12;
    // Breathers: every 7th level is a bit easier, keeps the rhythm fun.
    if (L > 10 && L % 7 === 0) colors = Math.max(5, colors - 2);
    const capacity = L >= 60 && L % 3 === 0 ? 5 : 4;
    const empty = 2;
    // Mystery levels hide everything under the top block.
    const mystery = L >= 8 && L % 5 === 3;
    return { colors: colors, capacity: capacity, empty: empty, mystery: mystery, seed: hashString('colorsort-level-' + L) };
  }

  function dailyConfig(dateStr) {
    const seed = hashString('colorsort-daily-' + dateStr);
    const r = mulberry32(seed);
    const colors = 9 + Math.floor(r() * 3); // 9–11
    return { colors: colors, capacity: 4, empty: 2, mystery: r() < 0.35, seed: seed };
  }

  function generate(cfg) {
    const cap = cfg.capacity;
    for (let attempt = 0; attempt < 200; attempt++) {
      const rand = mulberry32((cfg.seed + attempt * 0x9e3779b1) >>> 0);
      const pool = [];
      for (let c = 0; c < cfg.colors; c++) for (let k = 0; k < cap; k++) pool.push(c);
      shuffle(pool, rand);
      const tubes = [];
      for (let t = 0; t < cfg.colors; t++) tubes.push(pool.slice(t * cap, t * cap + cap));
      // Reject boards that start too tidy.
      let tidy = 0;
      for (const t of tubes) if (topRun(t) >= cap - 1) tidy++;
      if (tidy > 0) continue;
      for (let e = 0; e < cfg.empty; e++) tubes.push([]);
      const solution = solve(tubes, cap, { maxNodes: 60000, weight: 2 });
      if (!solution) continue;
      // Remap colours so the palette varies between levels.
      const perm = shuffle(Array.from({ length: PALETTE_SIZE }, (_, i) => i), rand);
      const mapped = tubes.map(t => t.map(c => perm[c]));
      return { tubes: mapped, capacity: cap, par: solution.length };
    }
    throw new Error('Could not generate level');
  }

  const api = {
    mulberry32, hashString, shuffle, topRun, pourAmount, isSolvedTube, isSolved,
    hasAnyMove, solve, PALETTE_SIZE, levelConfig, dailyConfig, generate, heuristic,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ColorSortCore = api;
})(typeof self !== 'undefined' ? self : this);
