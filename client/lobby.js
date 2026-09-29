/**
 * VOIDPLAY — client/lobby.js
 * ---------------------------------------------------------------------------
 * Single-page-app controller for screens 1-5:
 *   1 TITLE     logo + username
 *   2 MENU      create / join / friends
 *   3 ROOM      player list, 20-game selector grid, host START, chat
 *   4 GAME      engine takes over (canvas + HUD), ESC overlay
 *   5 RESULTS   winner, ranking, confetti, play-again / lobby / change game
 *
 * Also owns: friend list (localStorage) + presence, toasts, the connection
 * modal and best-effort auto-rejoin after a network blip.
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  const VP = window.VP;
  const COLORS = VP.colors;

  const $ = (id) => document.getElementById(id);

  const LS_NAME = 'voidplay.username';
  const LS_FRIENDS = 'voidplay.friends';

  // ==========================================================================
  // Game catalog — 20 games. `ready` games have a renderer in VP_GAMES and a
  // server implementation; the rest ship as locked cards until later phases.
  // ==========================================================================

  const CATALOG = [
    { id: 'tileCollapse', name: 'Tile Collapse', icon: '🧱', ready: true, min: 2 },
    { id: 'neonDrift', name: 'Neon Drift', icon: '🏎️', soon: true },
    { id: 'skyClimb', name: 'Sky Climb', icon: '🧗', soon: true },
    { id: 'infected', name: 'Infected', icon: '☣️', soon: true },
    { id: 'bumperKnock', name: 'Bumper Knock', icon: '🥊', soon: true },
    { id: 'reactionRoyale', name: 'Reaction Royale', icon: '⚡', soon: true },
    { id: 'orbitDodge', name: 'Orbit Dodge', icon: '🪐', soon: true },
    { id: 'bombTag', name: 'Bomb Tag', icon: '💣', soon: true },
    { id: 'colorRaid', name: 'Color Raid', icon: '🎨', soon: true },
    { id: 'lavaFloor', name: 'Lava Floor', icon: '🌋', soon: true },
    { id: 'laserMaze', name: 'Laser Maze', icon: '🔺', soon: true },
    { id: 'snakePit', name: 'Snake Pit', icon: '🐍', soon: true },
    { id: 'hoverHockey', name: 'Hover Hockey', icon: '🏒', soon: true },
    { id: 'pixelPaint', name: 'Pixel Paint', icon: '🖌️', soon: true },
    { id: 'gravityWell', name: 'Gravity Well', icon: '🌑', soon: true },
    { id: 'turboTag', name: 'Turbo Tag', icon: '🏃', soon: true },
    { id: 'asteroidStorm', name: 'Asteroid Storm', icon: '☄️', soon: true },
    { id: 'mazeRacer', name: 'Maze Racer', icon: '🌀', soon: true },
    { id: 'juggernaut', name: 'Juggernaut', icon: '🛡️', soon: true },
    { id: 'kingOfTheHill', name: 'King of the Hill', icon: '👑', soon: true },
  ];

  const byId = {};
  for (const g of CATALOG) byId[g.id] = g;

  // ==========================================================================
  // App state
  // ==========================================================================

  const app = {
    name: '',
    screen: 'title',
    room: null,          // mirror of server room snapshot
    myId: 0,
    friends: [],
    presence: {},        // lowerName → { online, room }
    hadRoomBeforeDrop: null,
    confettiStop: null,
  };

  // ==========================================================================
  // Screen helpers
  // ==========================================================================

  function show(screen) {
    app.screen = screen;
    for (const s of document.querySelectorAll('.screen')) s.classList.remove('active');
    $('screen-' + screen).classList.add('active');
  }

  function toast(msg, isError) {
    const el = document.createElement('div');
    el.className = 'toast' + (isError ? ' error' : '');
    el.textContent = msg;
    $('toast-dock').appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity 0.3s'; }, 2600);
    setTimeout(() => el.remove(), 3000);
  }

  let modalAction = null;
  function modal(title, sub, btnLabel, action) {
    $('modal-title').textContent = title;
    $('modal-sub').textContent = sub || '';
    $('modal-btn').textContent = btnLabel || 'OK';
    modalAction = action;
    $('modal').classList.remove('hidden');
  }
  $('modal-btn').addEventListener('click', () => {
    $('modal').classList.add('hidden');
    if (modalAction) { const a = modalAction; modalAction = null; a(); }
  });

  // ==========================================================================
  // Friends (localStorage + server presence)
  // ==========================================================================

  function loadFriends() {
    try { app.friends = JSON.parse(localStorage.getItem(LS_FRIENDS)) || []; }
    catch (e) { app.friends = []; }
    if (!Array.isArray(app.friends)) app.friends = [];
  }
  function saveFriends() {
    localStorage.setItem(LS_FRIENDS, JSON.stringify(app.friends));
    sendWatch();
  }

  function sendWatch() {
    VP.net.send(VP.net.MSG.SOCIAL, { e: 'watch', f: app.friends });
  }

  function renderFriends() {
    const list = $('friend-list');
    list.innerHTML = '';
    if (!app.friends.length) {
      const li = document.createElement('li');
      li.className = 'friend-empty';
      li.textContent = 'no friends yet — add someone\'s username above';
      list.appendChild(li);
      return;
    }
    for (const name of app.friends) {
      const pres = app.presence[name.toLowerCase()] || {};
      const li = document.createElement('li');
      li.className = 'friend-row' + (pres.online ? ' online' : '');

      const dot = document.createElement('span');
      dot.className = 'friend-dot';
      dot.title = pres.online ? 'online' : 'offline';

      const nm = document.createElement('span');
      nm.className = 'friend-name';
      nm.textContent = name;

      li.appendChild(dot);
      li.appendChild(nm);

      if (pres.online && pres.room) {
        const roomBtn = document.createElement('button');
        roomBtn.className = 'friend-room';
        roomBtn.textContent = pres.room;
        roomBtn.title = 'Join room ' + pres.room;
        roomBtn.addEventListener('click', () => {
          if (app.room) return toast('Leave your current room first', true);
          VP.net.send(VP.net.MSG.ROOM, { e: 'join', code: pres.room });
        });
        li.appendChild(roomBtn);
      }

      const x = document.createElement('button');
      x.className = 'friend-x';
      x.textContent = '✕';
      x.title = 'Remove friend';
      x.addEventListener('click', () => {
        app.friends = app.friends.filter((f) => f !== name);
        saveFriends();
        renderFriends();
      });
      li.appendChild(x);
      list.appendChild(li);
    }
  }

  $('btn-add-friend').addEventListener('click', addFriend);
  $('friend-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') addFriend(); });
  function addFriend() {
    const input = $('friend-name');
    const name = input.value.trim().slice(0, 16);
    if (!name) return;
    if (app.friends.includes(name)) { input.value = ''; return; }
    if (app.friends.length >= 50) return toast('Friend list is full', true);
    app.friends.push(name);
    input.value = '';
    saveFriends();
    renderFriends();
  }

  // ==========================================================================
  // Screen 1 — title
  // ==========================================================================

  $('username').value = localStorage.getItem(LS_NAME) || '';

  function enterMenu() {
    const name = $('username').value.replace(/\s+/g, ' ').trim().slice(0, 16);
    if (!name) { toast('Enter a username first', true); $('username').focus(); return; }
    app.name = name;
    localStorage.setItem(LS_NAME, name);
    $('menu-username').textContent = name.toUpperCase();
    show('menu');
    renderFriends();
    VP.net.send(VP.net.MSG.SOCIAL, { e: 'hello', name });
    sendWatch();
  }

  $('btn-continue').addEventListener('click', enterMenu);
  $('username').addEventListener('keydown', (e) => { if (e.key === 'Enter') enterMenu(); });
  $('btn-rename').addEventListener('click', () => { show('title'); $('username').focus(); });

  // ==========================================================================
  // Screen 2 — main menu
  // ==========================================================================

  $('btn-create').addEventListener('click', () => {
    VP.net.send(VP.net.MSG.ROOM, { e: 'create' });
  });

  function tryJoin() {
    const code = $('join-code').value.trim().toUpperCase();
    if (!/^[A-Z]{4}$/.test(code)) { toast('Room codes are 4 letters', true); return; }
    VP.net.send(VP.net.MSG.ROOM, { e: 'join', code });
  }
  $('btn-join').addEventListener('click', tryJoin);
  $('join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') tryJoin(); });

  // ==========================================================================
  // Screen 3 — room lobby
  // ==========================================================================

  function buildGameGrid() {
    const grid = $('game-grid');
    for (const g of CATALOG) {
      const card = document.createElement('button');
      card.className = 'game-card' + (g.soon ? ' locked' : '');
      card.dataset.game = g.id;
      card.innerHTML =
        (g.soon ? '<span class="gc-soon">SOON</span>' : '') +
        '<div class="gc-icon"></div>' +
        '<div class="gc-name"></div>';
      card.querySelector('.gc-icon').textContent = g.icon;
      card.querySelector('.gc-name').textContent = g.name;
      card.addEventListener('click', () => selectGame(g.id));
      grid.appendChild(card);
    }
  }

  function selectGame(id) {
    const g = byId[id];
    if (g.soon) { renderGameDetail(id); return; }         // everyone can browse
    if (!app.room || app.myId !== app.room.host) {         // non-hosts just view
      renderGameDetail(id);
      return;
    }
    VP.net.send(VP.net.MSG.ROOM, { e: 'pick', g: id });
  }

  function renderGameDetail(id) {
    const g = byId[id];
    const el = $('game-detail');
    if (!g) { el.innerHTML = '<div class="gd-desc">pick a game</div>'; return; }
    const mod = window.VP_GAMES && window.VP_GAMES[id];
    el.innerHTML = '';
    const t = document.createElement('div');
    t.className = 'gd-title';
    t.textContent = g.icon + '  ' + g.name.toUpperCase();
    el.appendChild(t);

    if (g.soon) {
      const s = document.createElement('div');
      s.className = 'gd-desc';
      s.textContent = 'Coming in a later phase.';
      el.appendChild(s);
      const n = document.createElement('div');
      n.className = 'gd-soon';
      n.textContent = '🔒 LOCKED — NOT IN THIS BUILD YET';
      el.appendChild(n);
      return;
    }

    const d = document.createElement('div');
    d.className = 'gd-desc';
    d.textContent = DESCRIPTIONS[id] || '';
    el.appendChild(d);

    const i = document.createElement('div');
    i.className = 'gd-instr';
    i.textContent = mod && mod.getInstructions ? '🎮 ' + mod.getInstructions() : '';
    el.appendChild(i);
  }

  // Descriptions for ready games (kept in sync with the server CONFIGs).
  const DESCRIPTIONS = {
    tileCollapse: 'Hop across a grid of neon tiles that crack and fall behind you. Outlive everyone else. 2-4 players.',
  };

  function renderRoom() {
    const room = app.room;
    if (!room) return;

    $('lobby-code').textContent = room.code;

    // player list
    const ul = $('lobby-players');
    ul.innerHTML = '';
    for (let slot = 1; slot <= 4; slot++) {
      const p = room.players.find((r) => r.s === slot);
      const li = document.createElement('li');
      if (!p) {
        li.className = 'player-row';
        li.innerHTML = '<span class="player-chip" style="background:rgba(255,255,255,0.06)"></span>' +
          '<span class="player-name" style="opacity:0.3">EMPTY SLOT</span>';
      } else {
        li.className = 'player-row';
        const chip = document.createElement('span');
        chip.className = 'player-chip';
        chip.style.background = COLORS[(p.s - 1) % 4];
        chip.style.boxShadow = '0 0 8px ' + COLORS[(p.s - 1) % 4];
        const nm = document.createElement('span');
        nm.className = 'player-name';
        nm.textContent = p.n;
        const tags = document.createElement('span');
        tags.className = 'player-tags';
        if (p.i === room.host) tags.innerHTML += '<span class="tag host">HOST</span>';
        if (p.i === app.myId) tags.innerHTML += '<span class="tag you">YOU</span>';
        li.appendChild(chip); li.appendChild(nm); li.appendChild(tags);
      }
      ul.appendChild(li);
    }
    $('lobby-count').textContent = room.players.length + ' / 4';

    // game grid selection
    for (const card of $('game-grid').children) {
      card.classList.toggle('selected', card.dataset.game === room.game);
    }
    renderGameDetail(room.game);

    // start button
    const g = byId[room.game];
    const isHost = app.myId === room.host;
    const enough = g && !g.soon && room.players.length >= (g.min || 2);
    const btn = $('btn-start');
    btn.disabled = !(isHost && enough && room.phase !== 'playing');
    btn.textContent = room.phase === 'results' ? 'BACK TO LOBBY FIRST' : 'START';
    $('start-hint').textContent = !isHost ? 'the host starts the match'
      : !room.game ? 'pick a game from the grid'
      : !enough ? 'need at least ' + (g.min || 2) + ' players'
      : byId[room.game].name.toUpperCase() + ' is ready — go!';
  }

  $('btn-copy-code').addEventListener('click', () => {
    const code = app.room && app.room.code;
    if (!code) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(
        () => toast('Room code ' + code + ' copied'),
        () => toast(code)
      );
    } else toast(code);
  });

  $('btn-leave').addEventListener('click', () => {
    VP.net.send(VP.net.MSG.ROOM, { e: 'leave' });
  });

  $('btn-start').addEventListener('click', () => {
    if (!app.room) return;
    if (app.room.phase === 'results') {
      VP.net.send(VP.net.MSG.ROOM, { e: 'lobby' });
    } else {
      VP.net.send(VP.net.MSG.ROOM, { e: 'start' });
    }
  });

  // -- lobby chat ------------------------------------------------------------

  function pushChat(n, t, color) {
    const log = $('chat-log');
    const b = document.createElement('b');
    b.textContent = n + ': ';
    if (color) b.style.color = color;
    const span = document.createElement('span');
    span.textContent = t;
    log.innerHTML = '';
    log.appendChild(b);
    log.appendChild(span);
  }

  function sendChat() {
    const input = $('chat-input');
    const t = input.value.trim().slice(0, 200);
    if (!t || !app.room) return;
    VP.net.send(VP.net.MSG.SOCIAL, { e: 'chat', t });
    input.value = '';
  }
  $('btn-chat-send').addEventListener('click', sendChat);
  $('chat-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });

  // ==========================================================================
  // Screen 4 — in-game extras (engine handles the canvas)
  // ==========================================================================

  $('btn-stay').addEventListener('click', () => $('leave-overlay').classList.add('hidden'));
  $('btn-leave-match').addEventListener('click', () => {
    $('leave-overlay').classList.add('hidden');
    VP.net.send(VP.net.MSG.ROOM, { e: 'leave' });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && app.screen === 'game') {
      $('leave-overlay').classList.toggle('hidden');
    }
  });

  // ==========================================================================
  // Screen 5 — results
  // ==========================================================================

  const REASONS = {
    'last-standing': 'LAST ONE STANDING',
    'void': 'THE VOID CLAIMS EVERYONE',
    'timeout': "TIME'S UP",
    'error': 'MATCH INTERRUPTED',
  };

  function showResults(result, room) {
    VP.engine.stop();
    if (app.confettiStop) { app.confettiStop(); app.confettiStop = null; }

    const roster = {};
    for (const r of room.players) roster[String(r.i)] = r;

    const title = $('results-title');
    if (result.w !== null && result.w !== undefined && roster[String(result.w)]) {
      const w = roster[String(result.w)];
      const color = COLORS[(w.s - 1) % 4];
      title.textContent = w.n.toUpperCase() + ' WINS';
      title.style.color = color;
      app.confettiStop = confetti(color);
    } else {
      title.textContent = 'NOBODY SURVIVES';
      title.style.color = '#ff00e4';
      app.confettiStop = confetti('#ff00e4');
    }
    $('results-sub').textContent = REASONS[result.reason] || '';

    const board = $('results-board');
    board.innerHTML = '';
    const rank = result.rank || [];
    for (let i = 0; i < rank.length; i++) {
      const r = roster[String(rank[i])];
      if (!r) continue;
      const li = document.createElement('li');
      li.className = 'results-row' + (rank[i] === result.w ? ' winner' : '');
      li.innerHTML =
        '<span class="place">' + (i + 1) + '</span>' +
        '<span class="player-chip" style="background:' + COLORS[(r.s - 1) % 4] + ';box-shadow:0 0 8px ' + COLORS[(r.s - 1) % 4] + '"></span>' +
        '<span class="player-name"></span>' +
        '<span class="note">' + (rank[i] === result.w ? 'WINNER' : 'FELL') + '</span>';
      li.querySelector('.player-name').textContent = r.n;
      board.appendChild(li);
    }

    const isHost = app.myId === room.host;
    $('btn-again').disabled = !isHost;
    $('btn-back-lobby').disabled = !isHost;
    $('btn-change-game').disabled = !isHost;
    $('results-wait').classList.toggle('hidden', isHost);
    show('results');
  }

  $('btn-again').addEventListener('click', () => {
    VP.net.send(VP.net.MSG.ROOM, { e: 'again' });
  });
  $('btn-back-lobby').addEventListener('click', () => {
    VP.net.send(VP.net.MSG.ROOM, { e: 'lobby' });
  });
  $('btn-change-game').addEventListener('click', () => {
    VP.net.send(VP.net.MSG.ROOM, { e: 'lobby' });
    app.focusGameGrid = true;          // pulse the grid when the lobby shows
  });

  function confetti(color) {
    const canvas = $('results-canvas');
    const ctx = canvas.getContext('2d');
    const W = canvas.width = canvas.clientWidth || innerWidth;
    const H = canvas.height = canvas.clientHeight || innerHeight;
    const colors = [color, '#ffffff', '#00fff2', '#ff00e4'];
    const parts = [];
    for (let i = 0; i < 130; i++) {
      parts.push({
        x: Math.random() * W, y: -20 - Math.random() * H * 0.5,
        vx: (Math.random() - 0.5) * 40, vy: 60 + Math.random() * 120,
        s: 3 + Math.random() * 5, rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 6, c: colors[(Math.random() * colors.length) | 0],
      });
    }
    let raf = 0, last = performance.now(), alive = true;
    (function loop(now) {
      if (!alive) return;
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      ctx.clearRect(0, 0, W, H);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const p of parts) {
        p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
        if (p.y > H + 20) { p.y = -20; p.x = Math.random() * W; }
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = p.c;
        ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6);
        ctx.restore();
      }
      ctx.restore();
      raf = requestAnimationFrame(loop);
    })(last);
    return function stop() { alive = false; cancelAnimationFrame(raf); ctx.clearRect(0, 0, W, H); };
  }

  // ==========================================================================
  // Network wiring
  // ==========================================================================

  VP.net.on(VP.net.MSG.ROOM, function (ev) {
    switch (ev.e) {
      case 'created':
      case 'joined': {
        app.room = ev.room;
        app.myId = ev.you;
        app.hadRoomBeforeDrop = ev.room.code;
        show('lobby');
        renderRoom();
        if (app.focusGameGrid) {
          app.focusGameGrid = false;
          const grid = $('game-grid');
          grid.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
        break;
      }
      case 'update': {
        if (!app.room || ev.room.code !== app.room.code) break;
        app.room = ev.room;
        if (app.screen === 'lobby') renderRoom();
        break;
      }
      case 'started': {
        app.room = ev.room;
        VP.lastStartedConfig = ev.config;
        if (app.confettiStop) { app.confettiStop(); app.confettiStop = null; }
        $('leave-overlay').classList.add('hidden');
        VP.engine.start({
          gameId: ev.game,
          myId: app.myId,
          roster: ev.room.players,
          config: ev.config,
          roomCode: ev.room.code,
        });
        show('game');
        break;
      }
      case 'ended': {
        app.room = ev.room;
        showResults(ev.result, ev.room);
        break;
      }
      case 'left': {
        app.room = null;
        app.hadRoomBeforeDrop = null;
        VP.engine.stop();
        if (app.confettiStop) { app.confettiStop(); app.confettiStop = null; }
        show('menu');
        renderFriends();
        break;
      }
      case 'error': {
        toast(ev.msg || 'Something went wrong', true);
        break;
      }
      default: break;
    }
  });

  VP.net.on(VP.net.MSG.SOCIAL, function (ev) {
    if (ev.e === 'chat') {
      const room = app.room;
      const p = room && room.players.find((r) => r.i === ev.i);
      const color = p ? COLORS[(p.s - 1) % 4] : '#fff';
      if (app.screen === 'lobby') pushChat(ev.n, ev.t, color);
      else if (app.screen === 'game') VP.engine.chatToast(ev.n, ev.t, color);
    } else if (ev.e === 'presence') {
      app.presence = {};
      for (const row of ev.f || []) {
        app.presence[row[0]] = { online: !!row[1], room: row[2] || null };
      }
      if (app.screen === 'menu') renderFriends();
    }
  });

  VP.net.on('open', function () {
    if (app.screen === 'title') return;
    // (re)introduce ourselves and refresh friend presence
    VP.net.send(VP.net.MSG.SOCIAL, { e: 'hello', name: app.name });
    sendWatch();
    // best-effort auto-rejoin after a network blip (rooms survive 30s empty)
    if (app.hadRoomBeforeDrop && !app.room && app.screen !== 'menu') {
      VP.net.send(VP.net.MSG.ROOM, { e: 'join', code: app.hadRoomBeforeDrop });
      app.rejoinAttempt = (app.rejoinAttempt || 0) + 1;
      if (app.rejoinAttempt > 1) app.hadRoomBeforeDrop = null;
    }
  });

  VP.net.on('close', function (evt) {
    if (app.screen === 'title') return;
    VP.engine.stop();
    if (app.screen === 'game' || app.screen === 'results') {
      show('menu');
    }
    if (evt && evt.wasConnected) {
      toast('Connection lost — reconnecting…', true);
    }
  });

  // ==========================================================================
  // Boot
  // ==========================================================================

  loadFriends();
  buildGameGrid();
  renderGameDetail(null);
  VP.net.connect();
})();
