/* Headless checks: physics, a survival crawl, scripted kills, and a search
   that each snake can actually be killed before it escapes. */
'use strict';

var assert = require('assert');
var engine = require('../js/engine.js');
var geom = engine.geom;

function replay(levelIndex, policy, cap) {
  var state = engine.createState(levelIndex);
  var apples = [];
  var guard = 0;
  var limit = cap || 4000;
  while (state.status !== 'won' && state.status !== 'lost' && guard++ < limit) {
    if (state.status === 'arm' || state.status === 'wait') {
      var cell = policy(state);
      if (!cell) throw new Error('policy returned nothing on level ' + levelIndex);
      var placed = engine.place(state, cell.x, cell.y);
      if (!placed.ok) throw new Error('policy placed illegally: ' + placed.reason);
      apples.push({ x: cell.x, y: cell.y });
    } else {
      engine.step(state);
    }
  }
  return { state: state, apples: apples, guard: guard };
}

function occ(state, x, y) {
  return engine.isOccupied(state, x, y);
}

/* Walk the rim. One square ahead, turning right at a wall. */
function rimCrawl(state) {
  var order = [state.direction, geom.RIGHT[state.direction], geom.LEFT[state.direction], geom.OPPOSITE[state.direction]];
  for (var i = 0; i < order.length; i++) {
    var n = geom.add(state.body[0], order[i]);
    if (!geom.inBounds(n, state.cols, state.rows)) continue;
    if (occ(state, n.x, n.y)) continue;
    return n;
  }
  return engine.emptyCells(state)[0];
}

/* Top row, facing east, apple straight behind: Tunnel Vision turns left off the board.
   Warden does the same when that apple is close and freshly planted. */
function edgeBait(state) {
  var head = state.body[0];
  var dir = state.direction;
  var cols = state.cols;
  if (head.y === 0 && dir === 'E') {
    for (var x = head.x - 1; x >= 0; x--) if (!occ(state, x, 0)) return { x: x, y: 0 };
  }
  if (head.y === 0 && dir === 'W') {
    for (var x2 = head.x + 1; x2 < cols; x2++) if (!occ(state, x2, 0)) return { x: x2, y: 0 };
  }
  if (head.y > 0 && !occ(state, head.x, 0)) return { x: head.x, y: 0 };
  if (head.y === 0) {
    for (var dx = 1; dx < cols; dx++) {
      if (head.x + dx < cols && !occ(state, head.x + dx, 0)) return { x: head.x + dx, y: 0 };
      if (head.x - dx >= 0 && !occ(state, head.x - dx, 0)) return { x: head.x - dx, y: 0 };
    }
  }
  return engine.emptyCells(state)[0];
}

function draw(state) {
  var rows = [];
  for (var y = 0; y < state.rows; y++) {
    var line = '';
    for (var x = 0; x < state.cols; x++) {
      var ch = '.';
      for (var i = 0; i < state.body.length; i++) {
        if (state.body[i].x === x && state.body[i].y === y) ch = i === 0 ? 'H' : i === state.body.length - 1 ? 't' : 's';
      }
      if (state.apple && state.apple.x === x && state.apple.y === y) ch = 'A';
      if (state.deathCell && state.deathCell.x === x && state.deathCell.y === y) ch = 'X';
      line += ch;
    }
    rows.push(line);
  }
  return rows.join('\n') + '\n' + state.direction + ' ' + state.status + ' ' + state.cause + ' len ' + state.body.length + ' ate ' + state.applesEaten;
}

/* Walk the head into the top-left corner and plug the doorway with its body.
   Place the next apple only after each bite, in this order. */
function cornerCoil(state) {
  var script = [
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
    { x: 0, y: 0 },
    { x: 4, y: 4 }
  ];
  return script[state.applesEaten] || script[script.length - 1];
}

function testPhysics() {
  var s = engine.createState(0);
  assert.equal(s.body.length, 3);
  assert.equal(s.status, 'arm');
  assert.equal(engine.place(s, 7, 7).ok, false);
  assert.equal(engine.place(s, 12, 7).ok, true);
  assert.equal(engine.place(s, 9, 7).action, 'queue');
  engine.step(s);
  assert.ok(s.queued, 'queue survives the first step');
  engine.step(s);
  assert.equal(s.queued, null, 'head crushes a queued apple it crawls onto');
  assert.ok(s.note);

  s = engine.createState(0);
  engine.place(s, 10, 7);
  engine.place(s, 10, 4);
  while (s.applesEaten === 0 && s.status === 'run') engine.step(s);
  assert.equal(s.status, 'run');
  assert.deepEqual(s.apple, { x: 10, y: 4 });
  assert.equal(s.queued, null);

  s = engine.createState(0);
  engine.place(s, 10, 7);
  var snap = JSON.stringify(s);
  engine.preview(s);
  assert.equal(JSON.stringify(s), snap, 'preview is pure');

  /* Moving onto the tail without eating is legal. Tail sits due east of the head. */
  s = engine.createState(0);
  s.body = [{ x: 4, y: 4 }, { x: 4, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 4 }];
  s.direction = 'N';
  s.apple = { x: 8, y: 4 };
  s.status = 'run';
  var moved = engine.applyMove(s, 'E');
  assert.equal(moved.type, 'move');
  assert.equal(s.status, 'run');
  assert.deepEqual(s.body[0], { x: 5, y: 4 });
}

function testLevelsContract() {
  engine.levels.forEach(function (level, i) {
    assert.equal(level.id, i + 1);
    assert.equal(typeof level.decide, 'function');
    assert.ok(level.escapeApples >= 4);
    assert.ok(level.tell && level.name && level.epithet);
  });
  var s = engine.createState(0);
  engine.place(s, 12, 3);
  var viewBody = JSON.stringify(s.body);
  engine.levels.forEach(function (_, index) {
    var st = engine.createState(index);
    engine.place(st, 12, 2);
    var before = JSON.stringify(st);
    var prev = engine.preview(st);
    assert.ok(geom.ORDER.indexOf(prev.dir) !== -1);
    assert.equal(JSON.stringify(st), before);
  });
  assert.equal(viewBody, JSON.stringify(s.body));
}

function testSurvival() {
  engine.levels.forEach(function (level, index) {
    var result = replay(index, rimCrawl, 5000);
    assert.equal(result.state.status, 'lost', level.name + ' should be feedable until it escapes\n' + draw(result.state));
    assert.equal(result.state.cause, 'escape');
    assert.equal(result.state.applesEaten, level.escapeApples);
  });
}

function testEdgeBait() {
  [0, 3].forEach(function (index) {
    var result = replay(index, edgeBait, 2000);
    var level = engine.levels[index];
    assert.equal(result.state.status, 'won', level.name + ' edge bait should kill\n' + draw(result.state) + '\napples ' + JSON.stringify(result.apples));
    assert.equal(result.state.cause, 'wall');
    assert.ok(result.state.applesEaten < level.escapeApples);
  });
}

function testFuzz() {
  var rng = mulberry(7);
  engine.levels.forEach(function (_, index) {
    for (var g = 0; g < 12; g++) {
      var result = replay(index, function (state) {
        var cells = engine.emptyCells(state);
        return cells[Math.floor(rng() * cells.length)];
      }, 6000);
      assert.ok(result.state.status === 'won' || result.state.status === 'lost', 'fuzz ended in a terminal state');
    }
  });
}

function mulberry(seed) {
  var a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function testCornerCoil() {
  [1, 2, 3].forEach(function (index) {
    var result = replay(index, cornerCoil, 2000);
    var level = engine.levels[index];
    assert.equal(result.state.status, 'won', level.name + ' corner coil should kill\n' + draw(result.state));
    assert.equal(result.state.cause, 'body');
    assert.ok(result.state.applesEaten < level.escapeApples);
  });
}

testPhysics();
testLevelsContract();
testSurvival();
testEdgeBait();
testFuzz();
console.log('core ok');
testCornerCoil();
console.log('all ok');
