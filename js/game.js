/* Rendering, input, and the clock. Rules live in engine.js. */
(function () {
  'use strict';

  var engine = window.EkansEngine;
  if (!engine) {
    document.body.innerHTML = '<p style="padding:24px">EKANS failed to load its scripts.</p>';
    return;
  }

  var levels = engine.levels;
  var SAVE_KEY = 'ekans.v1';

  var screen = document.getElementById('screen');
  var grid = document.getElementById('grid');
  var sprites = document.getElementById('sprites');
  var overlay = document.getElementById('overlay');
  var levelList = document.getElementById('level-list');
  var tell = document.getElementById('tell');
  var statusEl = document.getElementById('status');
  var noteEl = document.getElementById('note');
  var pipsEl = document.getElementById('pips');
  var escapeLabel = document.getElementById('escape-label');
  var speedInput = document.getElementById('speed');
  var speedReadout = document.getElementById('speed-readout');
  var bezelLevel = document.getElementById('bezel-level');
  var bezelSize = document.getElementById('bezel-size');
  var lights = document.getElementById('lights');
  var muteBtn = document.getElementById('mute');
  var againBtn = document.getElementById('overlay-again');
  var nextBtn = document.getElementById('overlay-next');

  var cells = [];
  var state = null;
  var levelIndex = 0;
  var elapsedMs = 0;
  var acc = 0;
  var lastTick = 0;
  var epoch = 0;
  var audio = null;
  var save = loadSave();
  var winMeta = null;

  function loadSave() {
    var base = { unlocked: 1, muted: false, tps: 6, best: {} };
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return base;
      var parsed = JSON.parse(raw);
      var tps = parsed.tps | 0;
      var unlocked = parsed.unlocked | 0;
      return {
        unlocked: Math.min(levels.length, Math.max(1, unlocked || 1)),
        muted: !!parsed.muted,
        tps: tps >= 2 && tps <= 14 ? tps : 6,
        best: parsed.best && typeof parsed.best === 'object' ? parsed.best : {}
      };
    } catch (err) {
      return base;
    }
  }

  function persist() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (err) { /* private mode */ }
  }

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function formatTime(ms) {
    var total = Math.max(0, ms / 1000);
    if (total < 10) return total.toFixed(1) + 's';
    var s = Math.floor(total);
    var m = Math.floor(s / 60);
    var r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }

  function mix(hexA, hexB, t) {
    function ch(h, i) { return parseInt(h.slice(i, i + 2), 16); }
    var parts = [1, 3, 5].map(function (i) {
      return Math.round(ch(hexA, i) + (ch(hexB, i) - ch(hexA, i)) * t);
    });
    return 'rgb(' + parts.join(',') + ')';
  }

  function ensureAudio() {
    if (save.muted) return null;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!audio) audio = new AC();
    if (audio.state === 'suspended') audio.resume();
    return audio;
  }

  function tone(freq, dur, type, gain, delay) {
    var ctx = ensureAudio();
    if (!ctx) return;
    var t = ctx.currentTime + (delay || 0);
    var osc = ctx.createOscillator();
    var amp = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(amp);
    amp.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function play(action) {
    if (save.muted) return;
    if (action === 'plant') tone(620, 0.07, 'sine', 0.05);
    else if (action === 'queue') tone(480, 0.06, 'sine', 0.04);
    else if (action === 'clear') tone(280, 0.05, 'sine', 0.04);
    else if (action === 'reject') tone(140, 0.05, 'triangle', 0.03);
    else if (action === 'eat') {
      tone(210, 0.08, 'triangle', 0.05);
      tone(420, 0.1, 'sine', 0.04, 0.06);
    } else if (action === 'crush') tone(110, 0.09, 'triangle', 0.04);
    else if (action === 'dead') {
      tone(180, 0.18, 'triangle', 0.06);
      tone(70, 0.32, 'sine', 0.05, 0.05);
    } else if (action === 'escape') {
      tone(440, 0.12, 'sine', 0.04);
      tone(330, 0.14, 'sine', 0.04, 0.1);
      tone(220, 0.2, 'sine', 0.04, 0.22);
    } else if (action === 'unlock') {
      tone(523, 0.08, 'sine', 0.04, 0.28);
      tone(659, 0.1, 'sine', 0.04, 0.38);
    }
  }

  function buildBoard() {
    var cols = engine.COLS;
    var rows = engine.ROWS;
    grid.style.setProperty('--cols', cols);
    grid.style.setProperty('--rows', rows);
    grid.innerHTML = '';
    cells = [];
    for (var y = 0; y < rows; y++) {
      cells[y] = [];
      for (var x = 0; x < cols; x++) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cell' + ((x + y) % 2 ? ' alt' : '');
        btn.dataset.x = String(x);
        btn.dataset.y = String(y);
        btn.setAttribute('aria-label', 'Column ' + (x + 1) + ', row ' + (y + 1));
        grid.appendChild(btn);
        cells[y][x] = btn;
      }
    }
    bezelSize.textContent = cols + ' × ' + rows;
  }

  function buildLevels() {
    levelList.innerHTML = '';
    levels.forEach(function (level, index) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'level';
      btn.dataset.index = String(index);
      btn.innerHTML =
        '<span class="lv-num">' + (index < 9 ? '0' : '') + level.id + '</span>' +
        '<span class="lv-copy"><strong></strong><em></em></span>' +
        '<span class="lv-mark" aria-hidden="true"></span>';
      btn.querySelector('strong').textContent = level.name;
      btn.querySelector('em').textContent = level.epithet;
      btn.addEventListener('click', function () {
        if (btn.disabled) return;
        if (index === levelIndex && state && state.status !== 'won' && state.status !== 'lost') return;
        startLevel(index);
      });
      levelList.appendChild(btn);
    });
  }

  function levelUnlocked(index) {
    return levels[index].id <= save.unlocked;
  }

  function startLevel(index) {
    epoch += 1;
    levelIndex = index;
    state = engine.createState(index);
    elapsedMs = 0;
    acc = 0;
    winMeta = null;
    hideOverlay();
    render();
  }

  function hideOverlay() {
    overlay.hidden = true;
    screen.classList.remove('shake', 'ate');
  }

  function showOverlay() {
    var level = levels[levelIndex];
    var won = state.status === 'won';
    document.getElementById('overlay-kicker').textContent = (won ? 'You win' : 'It escapes') + ' · ' + level.name;
    document.getElementById('overlay-title').textContent = won ? 'Dead snake.' : 'Too well fed.';
    var cause = state.cause === 'wall'
      ? 'It ran off the board.'
      : state.cause === 'body'
        ? 'It bit itself.'
        : 'It ate its fill and left the garden.';
    document.getElementById('overlay-cause').textContent = cause;
    document.getElementById('ov-apples').textContent = String(state.applesEaten);
    document.getElementById('ov-length').textContent = String(state.body.length);
    document.getElementById('ov-turns').textContent = String(state.turns);
    document.getElementById('ov-time').textContent = formatTime(elapsedMs);

    var extra = document.getElementById('overlay-extra');
    var lines = [];
    if (won && winMeta) {
      if (winMeta.newBest) lines.push('New best, ' + state.turns + ' turns.');
      if (winMeta.unlockedName) lines.push(winMeta.unlockedName + ' is awake.');
      if (level.id === levels.length) lines.push('The garden is quiet.');
    }
    extra.textContent = lines.join(' ');
    nextBtn.hidden = !(won && levelIndex + 1 < levels.length && levelUnlocked(levelIndex + 1));
    overlay.hidden = false;
    againBtn.focus();
  }

  function scheduleOverlay() {
    var token = epoch;
    window.setTimeout(function () {
      if (token !== epoch) return;
      if (state.status !== 'won' && state.status !== 'lost') return;
      showOverlay();
    }, 680);
  }

  function renderLevelButtons() {
    var buttons = levelList.querySelectorAll('.level');
    buttons.forEach(function (btn) {
      var index = Number(btn.dataset.index);
      var level = levels[index];
      var open = levelUnlocked(index);
      btn.disabled = !open;
      btn.setAttribute('aria-pressed', index === levelIndex ? 'true' : 'false');
      var mark = btn.querySelector('.lv-mark');
      mark.textContent = '';
      mark.className = 'lv-mark';
      if (!open) {
        mark.textContent = 'Locked';
        btn.title = 'Clear ' + levels[index - 1].name + ' to wake this snake.';
      } else if (save.best[level.id]) {
        mark.textContent = 'Cleared';
        mark.classList.add('cleared');
        btn.title = 'Best ' + save.best[level.id].turns + ' turns';
      } else {
        btn.title = '';
      }
    });
  }

  function renderPips() {
    var level = levels[levelIndex];
    var total = level.escapeApples;
    var eaten = state.applesEaten;
    pipsEl.innerHTML = '';
    for (var i = 0; i < total; i++) {
      var pip = document.createElement('i');
      pip.className = 'pip' + (i < eaten ? ' filled' : '') + (i === total - 1 ? ' door' : '');
      if (i === total - 1 && eaten === total - 1 && state.status === 'run') pip.classList.add('warn');
      pipsEl.appendChild(pip);
    }
    var left = Math.max(0, total - eaten);
    escapeLabel.textContent = left === 0
      ? 'It ate its fill.'
      : 'Escapes after ' + total + (total === 1 ? ' apple' : ' apples') + ' · ' + left + ' left';
  }

  function statusText() {
    if (state.status === 'won') {
      return state.cause === 'wall' ? 'It ran off the board.' : 'It bit itself.';
    }
    if (state.status === 'lost') return 'It ate its fill and left the garden.';
    if (state.status === 'arm') return 'Plant an apple on an empty square. The snake holds until you do.';
    if (state.status === 'wait') return 'It finished the apple and stopped. Plant the next one. The clock is paused.';
    if (state.queued) return 'Next apple marked. Tap another square to move it, or tap it again to clear it.';
    return 'It is hunting. Tap an empty square to queue the next apple.';
  }

  function renderSprites(preview) {
    var cols = state.cols;
    var body = state.body;
    var frag = document.createDocumentFragment();
    var doomedHead = preview && preview.fatal && !engine.geom.inBounds(preview.next, state.cols, state.rows);

    if (preview && engine.geom.inBounds(preview.next, state.cols, state.rows)) {
      var onApple = state.apple && preview.next.x === state.apple.x && preview.next.y === state.apple.y;
      if (preview.fatal || !onApple) {
        var intent = document.createElement('div');
        intent.className = 'spr intent' + (preview.fatal ? ' bad' : '');
        intent.style.setProperty('--x', preview.next.x);
        intent.style.setProperty('--y', preview.next.y);
        intent.innerHTML = '<span></span>';
        frag.appendChild(intent);
      }
    }

    for (var i = body.length - 1; i >= 0; i--) {
      var seg = document.createElement('div');
      seg.className = 'seg' + (i === 0 ? ' head' : '') + (i === 0 && doomedHead ? ' doomed' : '');
      seg.style.setProperty('--x', body[i].x);
      seg.style.setProperty('--y', body[i].y);
      seg.style.zIndex = String(20 + body.length - i);
      var scale = document.createElement('i');
      if (i === 0) {
        scale.style.background = (state.status === 'won' || doomedHead) ? '#e24b3a' : '#f4f1c4';
        seg.dataset.dir = state.direction;
        var face = document.createElement('span');
        face.className = 'face';
        face.innerHTML = '<b class="eye"></b><b class="eye"></b>';
        seg.appendChild(scale);
        seg.appendChild(face);
      } else {
        var t = body.length === 1 ? 1 : i / (body.length - 1);
        scale.style.background = mix('#e7f0a4', '#567332', Math.min(1, t));
        seg.appendChild(scale);
      }
      frag.appendChild(seg);
    }

    if (state.apple) frag.appendChild(appleSprite(state.apple, false));
    if (state.queued) frag.appendChild(appleSprite(state.queued, true));

    if (state.deathCell) {
      var crash = document.createElement('div');
      crash.className = 'spr crash';
      crash.style.setProperty('--x', state.deathCell.x);
      crash.style.setProperty('--y', state.deathCell.y);
      crash.innerHTML = '<span></span>';
      frag.appendChild(crash);
    }

    sprites.style.setProperty('--cols', cols);
    sprites.style.setProperty('--rows', state.rows);
    sprites.replaceChildren(frag);
  }

  function appleSprite(pos, ghost) {
    var el = document.createElement('div');
    el.className = 'spr apple' + (ghost ? ' ghost' : '');
    el.style.setProperty('--x', pos.x);
    el.style.setProperty('--y', pos.y);
    el.innerHTML = '<b class="apple-body"></b>';
    return el;
  }

  function render() {
    var level = levels[levelIndex];
    var look = engine.preview(state);

    for (var y = 0; y < state.rows; y++) {
      for (var x = 0; x < state.cols; x++) {
        var cell = cells[y][x];
        cell.classList.remove('is-occupied', 'is-apple', 'is-queue');
        if (engine.isOccupied(state, x, y)) cell.classList.add('is-occupied');
        if (state.apple && state.apple.x === x && state.apple.y === y) cell.classList.add('is-apple');
        if (state.queued && state.queued.x === x && state.queued.y === y) cell.classList.add('is-queue');
      }
    }

    renderSprites(look);
    renderPips();
    renderLevelButtons();

    document.getElementById('stat-apples').textContent = String(state.applesEaten);
    document.getElementById('stat-length').textContent = String(state.body.length);
    document.getElementById('stat-turns').textContent = String(state.turns);
    document.getElementById('stat-time').textContent = formatTime(elapsedMs);

    statusEl.textContent = statusText();
    noteEl.hidden = !state.note;
    noteEl.textContent = state.note || '';
    tell.textContent = level.tell;

    bezelLevel.textContent = (level.id < 10 ? '0' : '') + level.id + '  ' + level.name;
    screen.dataset.state = state.status;
    lights.className = 'lights ' + (
      state.status === 'run' ? 'go' :
      state.status === 'won' || state.status === 'lost' ? 'dead' : 'wait'
    );

    var best = save.best[level.id];
    var bestEl = document.getElementById('best-line');
    bestEl.textContent = best ? 'Best kill, ' + best.turns + ' turns.' : 'No kill yet.';
  }

  function recordWin() {
    var level = levels[levelIndex];
    var ms = Math.round(elapsedMs);
    var prev = save.best[level.id];
    var newBest = !prev || state.turns < prev.turns || (state.turns === prev.turns && ms < prev.ms);
    if (newBest) save.best[level.id] = { turns: state.turns, ms: ms, apples: state.applesEaten };
    var nextId = level.id + 1;
    var unlockedName = null;
    if (nextId <= levels.length && save.unlocked < nextId) {
      save.unlocked = nextId;
      unlockedName = levels[nextId - 1].name;
      play('unlock');
    }
    winMeta = { newBest: newBest, unlockedName: unlockedName };
    persist();
    renderLevelButtons();
  }

  function paintClock() {
    var text = formatTime(elapsedMs);
    document.getElementById('stat-time').textContent = text;
  }

  function onResult(result) {
    if (result.type === 'eat' || result.type === 'eat-wait') {
      play('eat');
      screen.classList.remove('ate');
      void screen.offsetWidth;
      screen.classList.add('ate');
    } else if (result.type === 'crush') {
      play('crush');
    } else if (result.type === 'dead') {
      play('dead');
      recordWin();
      screen.classList.add('shake');
      scheduleOverlay();
    } else if (result.type === 'escape') {
      play('escape');
      scheduleOverlay();
    }
    render();
  }

  function onPlace(x, y) {
    if (!state || state.status === 'won' || state.status === 'lost') return;
    ensureAudio();
    var result = engine.place(state, x, y);
    if (!result.ok) {
      play('reject');
      return;
    }
    play(result.action);
    if (result.action === 'plant') acc = 0;
    render();
  }

  function restart() {
    startLevel(levelIndex);
  }

  function setSpeed(tps) {
    save.tps = clamp(tps, 2, 14);
    speedInput.value = String(save.tps);
    speedReadout.textContent = String(save.tps);
    persist();
  }

  function setMuted(muted) {
    save.muted = muted;
    muteBtn.setAttribute('aria-pressed', muted ? 'true' : 'false');
    muteBtn.textContent = muted ? 'Sound off' : 'Sound on';
    persist();
  }

  function frame(now) {
    if (!lastTick) lastTick = now;
    var dt = Math.min(80, now - lastTick);
    lastTick = now;
    if (state && state.status === 'run') {
      elapsedMs += dt;
      acc += dt;
      var stepMs = 1000 / save.tps;
      if (acc >= stepMs) {
        acc -= stepMs;
        if (acc > stepMs) acc = 0;
        var result = engine.step(state);
        onResult(result);
      } else {
        paintClock();
      }
    }
    window.requestAnimationFrame(frame);
  }

  grid.addEventListener('click', function (event) {
    var cell = event.target.closest('.cell');
    if (!cell) return;
    onPlace(Number(cell.dataset.x), Number(cell.dataset.y));
  });

  grid.addEventListener('contextmenu', function (event) {
    event.preventDefault();
  });

  document.getElementById('restart').addEventListener('click', restart);
  document.getElementById('bezel-restart').addEventListener('click', restart);
  againBtn.addEventListener('click', restart);
  nextBtn.addEventListener('click', function () {
    if (levelIndex + 1 < levels.length && levelUnlocked(levelIndex + 1)) startLevel(levelIndex + 1);
  });

  muteBtn.addEventListener('click', function () {
    setMuted(!save.muted);
    if (!save.muted) {
      ensureAudio();
      play('plant');
    }
  });

  speedInput.addEventListener('input', function () {
    setSpeed(Number(speedInput.value));
  });

  window.addEventListener('keydown', function (event) {
    var tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    var key = event.key;
    if (key === 'r' || key === 'R') {
      event.preventDefault();
      restart();
    } else if (key === 'm' || key === 'M') {
      setMuted(!save.muted);
    } else if (key === '-' || key === '_') {
      setSpeed(save.tps - 1);
    } else if (key === '=' || key === '+') {
      setSpeed(save.tps + 1);
    } else if (key >= '1' && key <= '9') {
      var index = Number(key) - 1;
      if (index < levels.length && levelUnlocked(index)) startLevel(index);
    }
  });

  buildBoard();
  buildLevels();
  setSpeed(save.tps);
  setMuted(save.muted);
  startLevel(0);
  window.requestAnimationFrame(frame);
})();
