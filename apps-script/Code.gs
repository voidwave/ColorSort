/**
 * Color Sort leaderboard — Google Apps Script web app backed by a Google Sheet.
 *
 * Setup (see README "Leaderboard"):
 *   1. Create a Google Sheet, open Extensions → Apps Script.
 *   2. Replace Code.gs with this file and save.
 *   3. Deploy → New deployment → Web app, Execute as: Me, Who has access: Anyone.
 *   4. Put the /exec URL into js/config.js.
 */

var SHEET = 'Scores';
var HEADER = ['Timestamp', 'Board', 'PlayerId', 'Name', 'Moves', 'Seconds', 'Score', 'Par', 'Hints', 'ExtraTube'];
var COL = { time: 0, board: 1, player: 2, name: 3, moves: 4, seconds: 5, score: 6, par: 7, hints: 8, extra: 9 };
var TOP_N = 10;
var CACHE_SECONDS = 60;

// ---------- HTTP ----------
function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    if (p.action === 'board') return json_(boardStats_(String(p.board || ''), String(p.player || '')));
    if (p.action === 'top') return json_(topPlayers_(String(p.player || '')));
    return json_({ ok: true, service: 'colorsort-leaderboard' });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (body.action !== 'submit') return json_({ ok: false, error: 'unknown action' });
    return json_(submit_(body));
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- Validation ----------
function cleanName_(name) {
  var s = String(name || '').replace(/[\u0000-\u001f<>"'`\\]/g, '').replace(/\s+/g, ' ').trim();
  if (/^[=+\-@]/.test(s)) s = s.replace(/^[=+\-@]+/, ''); // no spreadsheet formulas
  return s.slice(0, 16) || 'Anonymous';
}

function cleanPlayer_(id) {
  var s = String(id || '');
  if (!/^[a-z0-9]{8,40}$/i.test(s)) throw new Error('bad player id');
  return s;
}

function checkBoard_(board) {
  if (!/^(L\d{1,6}|D\d{4}-\d{2}-\d{2})$/.test(board)) throw new Error('bad board');
  return board;
}

function int_(v, lo, hi) {
  var n = parseInt(v, 10);
  if (!isFinite(n)) n = lo;
  return Math.max(lo, Math.min(hi, n));
}

// Fewer moves, quicker time and no assists score higher.
function scoreFor_(par, moves, seconds, hints, extra) {
  var s = 1000 + (par - moves) * 40 - Math.min(seconds, 600) - hints * 100 - (extra ? 150 : 0);
  return Math.max(50, Math.round(s));
}

// ---------- Submit ----------
function submit_(body) {
  var board = checkBoard_(String(body.board || ''));
  var player = cleanPlayer_(body.player);
  var name = cleanName_(body.name);
  var moves = int_(body.moves, 1, 100000);
  var par = int_(body.par, 1, 10000);
  var seconds = int_(body.seconds, 0, 86400);
  var hints = int_(body.hints, 0, 999);
  var extra = body.extra ? 1 : 0;
  var score = scoreFor_(par, moves, seconds, hints, extra);
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    sheet_().appendRow([new Date(), board, player, name, moves, seconds, score, par, hints, extra]);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  var cache = CacheService.getScriptCache();
  cache.removeAll(['board:' + board, 'top']);
  var stats = boardStats_(board, player);
  stats.submitted = { moves: moves, seconds: seconds, score: score };
  return stats;
}

// ---------- Reads ----------
function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET);
  if (!sh) {
    sh = ss.insertSheet(SHEET);
    sh.appendRow(HEADER);
    sh.setFrozenRows(1);
  }
  return sh;
}

function rows_() {
  var sh = sheet_();
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, HEADER.length).getValues();
}

// Best solve per player (fewest moves, then fastest, then earliest), with their latest name.
function bestByPlayer_(rows, board) {
  var best = {}, names = {};
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    names[r[COL.player]] = r[COL.name];
    if (board && r[COL.board] !== board) continue;
    var cur = best[r[COL.player]];
    if (!cur || r[COL.moves] < cur[COL.moves] || (r[COL.moves] === cur[COL.moves] && r[COL.seconds] < cur[COL.seconds])) {
      best[r[COL.player]] = r;
    }
  }
  return { best: best, names: names };
}

function boardStats_(board, player) {
  checkBoard_(board);
  var cache = CacheService.getScriptCache();
  var key = 'board:' + board;
  var hit = cache.get(key);
  var agg;
  if (hit) {
    agg = JSON.parse(hit);
  } else {
    var rows = rows_();
    var by = bestByPlayer_(rows, board);
    var par = null;
    for (var j = rows.length - 1; j >= 0; j--) if (rows[j][COL.board] === board) { par = rows[j][COL.par]; break; }
    var list = [];
    for (var id in by.best) {
      var r = by.best[id];
      list.push({ id: id, name: by.names[id], moves: r[COL.moves], seconds: r[COL.seconds], score: r[COL.score] });
    }
    list.sort(function (a, b) { return a.moves - b.moves || a.seconds - b.seconds || b.score - a.score; });
    var hist = {};
    list.forEach(function (x) { hist[x.moves] = (hist[x.moves] || 0) + 1; });
    var histogram = Object.keys(hist).map(Number).sort(function (a, b) { return a - b; })
      .map(function (m) { return { moves: m, count: hist[m] }; });
    var bestScore = list.reduce(function (m, x) { return x.score > (m ? m.score : -1) ? x : m; }, null);
    agg = {
      board: board,
      par: par,
      solvers: list.length,
      fewest: list.length ? { moves: list[0].moves, name: list[0].name } : null,
      bestScore: bestScore ? { score: bestScore.score, name: bestScore.name } : null,
      histogram: histogram,
      ranked: list.map(function (x) { return [x.id, x.name, x.moves, x.seconds, x.score]; }),
    };
    try { cache.put(key, JSON.stringify(agg), CACHE_SECONDS); } catch (e) { /* too big to cache */ }
  }
  var me = null;
  var top = [];
  for (var i = 0; i < agg.ranked.length; i++) {
    var x = agg.ranked[i];
    var row = { rank: i + 1, name: x[1], moves: x[2], seconds: x[3], score: x[4], you: x[0] === player };
    if (i < TOP_N) top.push(row);
    if (row.you) me = row;
  }
  return {
    ok: true, board: agg.board, par: agg.par, solvers: agg.solvers, fewest: agg.fewest,
    bestScore: agg.bestScore, histogram: agg.histogram, top: top, me: me,
  };
}

function topPlayers_(player) {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('top');
  var ranked;
  if (hit) {
    ranked = JSON.parse(hit);
  } else {
    var rows = rows_();
    // Sum of each player's best score per board.
    var best = {}, names = {};
    rows.forEach(function (r) {
      var id = r[COL.player];
      names[id] = r[COL.name];
      var k = id + '|' + r[COL.board];
      if (!best[k] || r[COL.score] > best[k].score) best[k] = { id: id, score: r[COL.score] };
    });
    var totals = {};
    Object.keys(best).forEach(function (k) {
      var b = best[k];
      totals[b.id] = totals[b.id] || { id: b.id, score: 0, solved: 0 };
      totals[b.id].score += b.score;
      totals[b.id].solved++;
    });
    ranked = Object.keys(totals).map(function (id) {
      var t = totals[id];
      return [id, names[id], t.score, t.solved];
    }).sort(function (a, b) { return b[2] - a[2] || b[3] - a[3]; });
    try { cache.put('top', JSON.stringify(ranked), CACHE_SECONDS); } catch (e) { /* too big to cache */ }
  }
  var top = [], me = null;
  for (var i = 0; i < ranked.length; i++) {
    var x = ranked[i];
    var row = { rank: i + 1, name: x[1], score: x[2], solved: x[3], you: x[0] === player };
    if (i < 25) top.push(row);
    if (row.you) me = row;
  }
  return { ok: true, players: ranked.length, top: top, me: me };
}

// ---------- Sheet helpers for the owner ----------
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Color Sort')
    .addItem('Refresh summary sheets', 'refreshSummary')
    .addToUi();
}

/** Writes "Boards" and "Players" summary tabs you can browse inside the spreadsheet. */
function refreshSummary() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var rows = rows_();
  var boards = {};
  rows.forEach(function (r) { boards[r[COL.board]] = true; });
  var out = [['Board', 'Par', 'Solvers', 'Fewest moves', 'By', 'Best score', 'By', 'Moves → solvers']];
  Object.keys(boards).sort().forEach(function (b) {
    var s = boardStats_(b, '');
    out.push([b, s.par, s.solvers, s.fewest ? s.fewest.moves : '', s.fewest ? s.fewest.name : '',
      s.bestScore ? s.bestScore.score : '', s.bestScore ? s.bestScore.name : '',
      s.histogram.map(function (h) { return h.moves + '→' + h.count; }).join(', ')]);
  });
  writeTab_(ss, 'Boards', out);
  var tp = topPlayers_('');
  writeTab_(ss, 'Players', [['Rank', 'Name', 'Total score', 'Levels solved']].concat(
    tp.top.map(function (p) { return [p.rank, p.name, p.score, p.solved]; })));
}

function writeTab_(ss, name, values) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.clearContents();
  sh.getRange(1, 1, values.length, values[0].length).setValues(values);
  sh.setFrozenRows(1);
}
