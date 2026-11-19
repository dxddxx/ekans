/* EKANS snake brains.
 *
 * Each level is one object in `levels`. To add a level, append another object
 * with { id, name, epithet, tell, escapeApples, decide }. The page builds the
 * selector, the escape pips, and the unlock order from that list.
 *
 * decide(view) -> 'N' | 'E' | 'S' | 'W'
 *   view.head, view.body   body[0] is the head, body[last] is the tail
 *   view.apple             the apple it is hunting right now
 *   view.direction         the way the head is facing
 *   view.cols, view.rows
 *   view.applesEaten
 *   view.stepsSinceApple   0 on the first step after an apple appears
 *
 * A returned move may leave the board or enter the body. That kills the snake.
 * A 180° reversal enters the neck and kills it too. Do not mutate view.
 */
(function (root) {
  'use strict';

  var DELTA = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
  var OPPOSITE = { N: 'S', S: 'N', E: 'W', W: 'E' };
  var LEFT = { N: 'W', W: 'S', S: 'E', E: 'N' };
  var RIGHT = { N: 'E', E: 'S', S: 'W', W: 'N' };
  var ORDER = ['N', 'E', 'S', 'W'];

  /* An apple this close (Manhattan) makes Warden take one blind step. */
  var HUNGER_RANGE = 4;

  function add(p, dir) {
    var d = DELTA[dir];
    return { x: p.x + d[0], y: p.y + d[1] };
  }

  function inBounds(p, cols, rows) {
    return p.x >= 0 && p.y >= 0 && p.x < cols && p.y < rows;
  }

  function key(p) {
    return p.x + ',' + p.y;
  }

  function manhattan(a, b) {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }

  function same(a, b) {
    return a.x === b.x && a.y === b.y;
  }

  /* True when `cell` is currently body. The tail cell is free when the snake
     is not about to grow, because that segment is about to slide away. */
  function realHit(cell, body, eating) {
    for (var i = 0; i < body.length; i++) {
      if (body[i].x === cell.x && body[i].y === cell.y) {
        if (!eating && i === body.length - 1) return false;
        return true;
      }
    }
    return false;
  }

  /* Closer to the apple first, then straight ahead, then left. Never the
     reverse of the current direction — callers that want a suicidal U-turn
     use lunge() instead. */
  function rankDirections(view) {
    var rev = OPPOSITE[view.direction];
    var left = LEFT[view.direction];
    var dirs = ORDER.filter(function (d) { return d !== rev; });
    dirs.sort(function (a, b) {
      var da = manhattan(add(view.head, a), view.apple);
      var db = manhattan(add(view.head, b), view.apple);
      if (da !== db) return da - db;
      var sa = a === view.direction ? 0 : 1;
      var sb = b === view.direction ? 0 : 1;
      if (sa !== sb) return sa - sb;
      var la = a === left ? 0 : 1;
      var lb = b === left ? 0 : 1;
      if (la !== lb) return la - lb;
      return 0;
    });
    return dirs;
  }

  /* Step onto the neighbor with the smallest Manhattan distance to the apple,
     walls and flesh included. Distance drops by one each call, so this cannot
     orbit: it bites the apple, or it crashes on the way. */
  function lunge(view) {
    var best = view.direction;
    var bestKey = Infinity;
    for (var i = 0; i < ORDER.length; i++) {
      var d = ORDER[i];
      var dist = manhattan(add(view.head, d), view.apple);
      var straight = d === view.direction ? 0 : 1;
      var score = dist * 10 + straight;
      if (score < bestKey) {
        bestKey = score;
        best = d;
      }
    }
    return best;
  }

  /* First step of a shortest path from the head to the apple.
     `blocked` is a set of "x,y" keys. The apple itself is always enterable.
     `forbiddenFirst` (usually the reverse direction) is refused for the first
     step only. Returns null when no path exists. */
  function bfsDir(view, blocked, forbiddenFirst) {
    var startKey = key(view.head);
    var goalKey = key(view.apple);
    if (startKey === goalKey) return null;
    var prev = new Map();
    prev.set(startKey, null);
    var q = [view.head];
    var qi = 0;
    while (qi < q.length) {
      var cur = q[qi++];
      var ck = key(cur);
      if (ck === goalKey) break;
      for (var i = 0; i < ORDER.length; i++) {
        var d = ORDER[i];
        if (ck === startKey && d === forbiddenFirst) continue;
        var n = add(cur, d);
        if (!inBounds(n, view.cols, view.rows)) continue;
        var nk = key(n);
        if (prev.has(nk)) continue;
        if (nk !== goalKey && blocked.has(nk)) continue;
        prev.set(nk, { at: ck, dir: d });
        q.push(n);
      }
    }
    if (!prev.has(goalKey)) return null;
    var cursor = goalKey;
    var firstDir = null;
    while (prev.get(cursor)) {
      var hop = prev.get(cursor);
      firstDir = hop.dir;
      cursor = hop.at;
    }
    return firstDir;
  }

  function canReach(start, goal, blocked, cols, rows) {
    var goalKey = key(goal);
    if (key(start) === goalKey) return true;
    var seen = new Set([key(start)]);
    var q = [start];
    var qi = 0;
    while (qi < q.length) {
      var cur = q[qi++];
      for (var i = 0; i < ORDER.length; i++) {
        var n = add(cur, ORDER[i]);
        if (!inBounds(n, cols, rows)) continue;
        var k = key(n);
        if (seen.has(k)) continue;
        if (k !== goalKey && blocked.has(k)) continue;
        if (k === goalKey) return true;
        seen.add(k);
        q.push(n);
      }
    }
    return false;
  }

  /* Level 1 — Tunnel Vision.
     Finish the longer axis, then the other. Ties prefer the horizontal axis.
     The square it steps on is never inspected, so the body and the walls are
     invisible. It will not reverse into its neck. When the only toward-apple
     directions are reversals (the apple is straight behind it), it turns left
     and commits, even if left is off the board. */
  function tunnel(view) {
    var dx = view.apple.x - view.head.x;
    var dy = view.apple.y - view.head.y;
    var horiz = dx === 0 ? null : dx > 0 ? 'E' : 'W';
    var vert = dy === 0 ? null : dy > 0 ? 'S' : 'N';
    var prefs = [];
    if (Math.abs(dx) >= Math.abs(dy)) {
      if (horiz) prefs.push(horiz);
      if (vert) prefs.push(vert);
    } else {
      if (vert) prefs.push(vert);
      if (horiz) prefs.push(horiz);
    }
    var rev = OPPOSITE[view.direction];
    for (var i = 0; i < prefs.length; i++) {
      if (prefs[i] !== rev) return prefs[i];
    }
    return LEFT[view.direction];
  }

  /* Level 2 — Short Leash.
     Same ranking as a greedy chase, but a candidate is skipped when the next
     square is off the board OR currently occupied. The tail counts as occupied
     even though it is about to move — that is the flaw. Nothing past the next
     square is considered, so corridors and corners are invisible until the
     head is already inside them. If every legal neighbor is rejected, it
     lunges and can reverse into itself. */
  function shortLeash(view) {
    if (view.stepsSinceApple >= view.cols * view.rows) return lunge(view);
    var blocked = new Set(view.body.map(key));
    var ranked = rankDirections(view);
    for (var i = 0; i < ranked.length; i++) {
      var n = add(view.head, ranked[i]);
      if (!inBounds(n, view.cols, view.rows)) continue;
      if (blocked.has(key(n))) continue;
      return ranked[i];
    }
    return lunge(view);
  }

  /* Level 3 — Shortcut.
     BFS shortest path, replanned every turn. Every segment except the tail is
     a wall. The tail is treated as already gone, and the rest of the body is
     treated as frozen for the whole search — future sliding is ignored. The
     first step will not be a U-turn. If the search finds no path, it lunges,
     U-turn included, through whatever sits between it and the apple. */
  function shortcut(view) {
    var blocked = new Set(view.body.slice(0, -1).map(key));
    var dir = bfsDir(view, blocked, OPPOSITE[view.direction]);
    if (dir) return dir;
    return lunge(view);
  }

  /* After stepping `dir`, can the head still reach its tail?
     Flaw: the tail is always removed in this rehearsal, including when the
     step lands on the apple and the real snake would grow and keep it. */
  function reachesTailOptimistic(view, dir) {
    var n = add(view.head, dir);
    var nextBody = [n].concat(view.body.slice(0, -1));
    var tail = nextBody[nextBody.length - 1];
    var blocked = new Set(nextBody.slice(0, -1).map(key));
    return canReach(n, tail, blocked, view.cols, view.rows);
  }

  /* Level 4 — Warden.
     Follow the shortest path when the first step is immediately safe AND the
     optimistic tail-check passes. Otherwise take another safe step that still
     reaches the tail, so it will refuse a dead end it can already see.
     Two holes, on purpose:
       1. Hunger. If the apple is within HUNGER_RANGE and this is the first
          step of the chase, skip every check and move like Tunnel Vision.
       2. Temper. If no shortest path exists, or it has wandered a full garden
          without eating, drop the checks and lunge. */
  function warden(view) {
    var blocked = new Set(view.body.slice(0, -1).map(key));
    var pathDir = bfsDir(view, blocked, OPPOSITE[view.direction]);
    var dist = manhattan(view.head, view.apple);
    if (!pathDir || view.stepsSinceApple >= view.cols * view.rows) return lunge(view);
    if (view.stepsSinceApple === 0 && dist <= HUNGER_RANGE) return tunnel(view);

    var ordered = [pathDir];
    var ranked = rankDirections(view);
    for (var i = 0; i < ranked.length; i++) {
      if (ordered.indexOf(ranked[i]) === -1) ordered.push(ranked[i]);
    }

    var fallback = null;
    for (var j = 0; j < ordered.length; j++) {
      var d = ordered[j];
      var n = add(view.head, d);
      if (!inBounds(n, view.cols, view.rows)) continue;
      var eating = same(n, view.apple);
      if (realHit(n, view.body, eating)) continue;
      if (!fallback) fallback = d;
      if (reachesTailOptimistic(view, d)) return d;
    }
    if (fallback) return fallback;
    return lunge(view);
  }

  var levels = [
    {
      id: 1,
      name: 'Tunnel Vision',
      epithet: 'Axis chase',
      tell: 'It finishes the longer axis, then the shorter one, and steps into whatever is there. An apple straight behind it becomes a left turn, even off the board.',
      escapeApples: 8,
      decide: tunnel
    },
    {
      id: 2,
      name: 'Short Leash',
      epithet: 'One step',
      tell: 'The next square is blocked if it holds a wall, the body, or the tail. Anything farther is invisible. With nowhere left to step, it lunges.',
      escapeApples: 10,
      decide: shortLeash
    },
    {
      id: 3,
      name: 'Shortcut',
      epithet: 'Shortest path',
      tell: 'It follows a shortest path around the body as the body lies this moment, and it treats the tail as already gone. Cut the apple off and it lunges through the blockage.',
      escapeApples: 12,
      decide: shortcut
    },
    {
      id: 4,
      name: 'Warden',
      epithet: 'Tail check',
      tell: 'It keeps a path back to its tail, though it forgets the tail stays put on a bite. Inside 4 tiles its first step is blind. A cut-off apple makes it charge.',
      escapeApples: 14,
      decide: warden
    }
  ];

  var api = {
    levels: levels,
    HUNGER_RANGE: HUNGER_RANGE,
    geom: {
      DELTA: DELTA,
      OPPOSITE: OPPOSITE,
      LEFT: LEFT,
      RIGHT: RIGHT,
      ORDER: ORDER,
      add: add,
      inBounds: inBounds,
      key: key,
      manhattan: manhattan
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.EkansAI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
