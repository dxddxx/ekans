/* Board rules for EKANS. No rendering here.
   The snake physics live in applyMove. Strategies only pick a direction. */
(function (root) {
  'use strict';

  var ai = (typeof root !== 'undefined' && root.EkansAI) ? root.EkansAI : require('./ai.js');
  var geom = ai.geom;
  var DIRS = { N: true, E: true, S: true, W: true };

  var COLS = 15;
  var ROWS = 15;

  function createState(levelIndex) {
    var cx = (COLS - 1) >> 1;
    var cy = (ROWS - 1) >> 1;
    return {
      levelIndex: levelIndex,
      cols: COLS,
      rows: ROWS,
      body: [
        { x: cx, y: cy },
        { x: cx - 1, y: cy },
        { x: cx - 2, y: cy }
      ],
      direction: 'E',
      apple: null,
      queued: null,
      applesEaten: 0,
      turns: 0,
      stepsSinceApple: 0,
      status: 'arm',
      cause: null,
      deathCell: null,
      note: null
    };
  }

  function cloneState(state) {
    return {
      levelIndex: state.levelIndex,
      cols: state.cols,
      rows: state.rows,
      body: state.body.map(function (p) { return { x: p.x, y: p.y }; }),
      direction: state.direction,
      apple: state.apple ? { x: state.apple.x, y: state.apple.y } : null,
      queued: state.queued ? { x: state.queued.x, y: state.queued.y } : null,
      applesEaten: state.applesEaten,
      turns: state.turns,
      stepsSinceApple: state.stepsSinceApple,
      status: state.status,
      cause: state.cause,
      deathCell: state.deathCell ? { x: state.deathCell.x, y: state.deathCell.y } : null,
      note: state.note
    };
  }

  function isOccupied(state, x, y) {
    for (var i = 0; i < state.body.length; i++) {
      if (state.body[i].x === x && state.body[i].y === y) return true;
    }
    return false;
  }

  function emptyCells(state) {
    var out = [];
    for (var y = 0; y < state.rows; y++) {
      for (var x = 0; x < state.cols; x++) {
        if (isOccupied(state, x, y)) continue;
        if (state.apple && state.apple.x === x && state.apple.y === y) continue;
        out.push({ x: x, y: y });
      }
    }
    return out;
  }

  /* Real collision, shared by the simulator and the "next step" preview.
     Moving onto the tail is safe when the snake is not growing. */
  function assessMove(state, dir) {
    var next = geom.add(state.body[0], dir);
    if (!geom.inBounds(next, state.cols, state.rows)) {
      return { next: next, fatal: true, cause: 'wall', eating: false };
    }
    var eating = !!(state.apple && next.x === state.apple.x && next.y === state.apple.y);
    for (var i = 0; i < state.body.length; i++) {
      if (state.body[i].x === next.x && state.body[i].y === next.y) {
        if (!eating && i === state.body.length - 1) break;
        return { next: next, fatal: true, cause: 'body', eating: eating };
      }
    }
    return { next: next, fatal: false, cause: null, eating: eating };
  }

  function makeView(state) {
    return {
      head: { x: state.body[0].x, y: state.body[0].y },
      body: state.body.map(function (p) { return { x: p.x, y: p.y }; }),
      apple: { x: state.apple.x, y: state.apple.y },
      direction: state.direction,
      cols: state.cols,
      rows: state.rows,
      applesEaten: state.applesEaten,
      stepsSinceApple: state.stepsSinceApple
    };
  }

  function place(state, x, y) {
    if (state.status === 'won' || state.status === 'lost') return { ok: false, reason: 'over' };
    if (!geom.inBounds({ x: x, y: y }, state.cols, state.rows)) return { ok: false, reason: 'bounds' };
    if (isOccupied(state, x, y)) return { ok: false, reason: 'body' };
    if (state.apple && state.apple.x === x && state.apple.y === y) return { ok: false, reason: 'apple' };
    if (state.queued && state.queued.x === x && state.queued.y === y) {
      state.queued = null;
      state.note = null;
      return { ok: true, action: 'clear' };
    }
    state.note = null;
    if (!state.apple) {
      state.apple = { x: x, y: y };
      state.stepsSinceApple = 0;
      state.status = 'run';
      return { ok: true, action: 'plant' };
    }
    state.queued = { x: x, y: y };
    return { ok: true, action: 'queue' };
  }

  function applyMove(state, dir) {
    if (!DIRS[dir]) dir = state.direction;
    state.direction = dir;
    state.turns += 1;
    var verdict = assessMove(state, dir);
    if (verdict.fatal) {
      state.status = 'won';
      state.cause = verdict.cause;
      state.deathCell = geom.inBounds(verdict.next, state.cols, state.rows) ? { x: verdict.next.x, y: verdict.next.y } : null;
      return { type: 'dead', cause: verdict.cause };
    }
    var next = verdict.next;
    state.body.unshift({ x: next.x, y: next.y });
    if (verdict.eating) {
      state.applesEaten += 1;
      state.apple = null;
      state.stepsSinceApple = 0;
      var level = ai.levels[state.levelIndex];
      if (state.applesEaten >= level.escapeApples) {
        state.status = 'lost';
        state.cause = 'escape';
        state.queued = null;
        return { type: 'escape' };
      }
      if (state.queued && isOccupied(state, state.queued.x, state.queued.y)) {
        state.queued = null;
        state.note = 'It crawled over the apple you had waiting.';
      }
      if (state.queued) {
        state.apple = { x: state.queued.x, y: state.queued.y };
        state.queued = null;
        state.stepsSinceApple = 0;
        return { type: 'eat' };
      }
      state.status = 'wait';
      return { type: 'eat-wait' };
    }
    state.body.pop();
    state.stepsSinceApple += 1;
    if (state.queued && isOccupied(state, state.queued.x, state.queued.y)) {
      state.queued = null;
      state.note = 'It crawled over the apple you had waiting.';
      return { type: 'crush' };
    }
    return { type: 'move' };
  }

  function step(state) {
    if (state.status !== 'run' || !state.apple) return { type: 'idle' };
    var level = ai.levels[state.levelIndex];
    var dir = level.decide(makeView(state));
    return applyMove(state, dir);
  }

  function preview(state) {
    if (state.status !== 'run' || !state.apple) return null;
    var level = ai.levels[state.levelIndex];
    var dir = level.decide(makeView(state));
    if (!DIRS[dir]) dir = state.direction;
    var verdict = assessMove(state, dir);
    return {
      dir: dir,
      next: verdict.next,
      fatal: verdict.fatal,
      cause: verdict.cause,
      eating: verdict.eating
    };
  }

  var api = {
    COLS: COLS,
    ROWS: ROWS,
    levels: ai.levels,
    geom: geom,
    createState: createState,
    cloneState: cloneState,
    isOccupied: isOccupied,
    emptyCells: emptyCells,
    place: place,
    step: step,
    applyMove: applyMove,
    preview: preview
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.EkansEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
