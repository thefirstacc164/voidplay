(function (root) {
  'use strict';

  var VP = root.VP;
  var net = VP.net;
  var ITEMS = VP.ITEMS;
  var sound = VP.sound || { muted: function () { return false; } };
  function snd(name) { if (sound[name]) sound[name](); }
  var $ = function (id) { return document.getElementById(id); };

  var RANK_REWARDS = [60, 30, 15, 10];
  var PLAY_BONUS = 10;

  var state = {
    name: 'Guest',
    authed: false,
    profile: null,
    token: null,
    manifest: null,
    loadMode: null,
    wallet: 0,
    room: null,
    myPid: null,
    lastPicked: null,
    pendingGame: null,
    friends: {},
    botCount: 1,
    shopTab: 'shape',
    lastResult: null,
    remoteMode: false,
    lastRoomCode: null,
  };

  function lsGet(k, d) {
    try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; }
  }
  function lsSet(k, v) {
    try { localStorage.setItem(k, v); } catch (e) {}
  }

  state.token = lsGet('vp.token', null);
  state.loadMode = lsGet('vp.loadMode', null);
  state.wallet = parseInt(lsGet('vp.coins', '0'), 10) || 0;

  function saveWallet() { lsSet('vp.coins', String(state.wallet)); }

  function confetti() {
    var host = document.querySelector('.screen.active') || document.body;
    var colors = ['#00fff2', '#ff0099', '#39ff14', '#ffd94a', '#ffffff'];
    for (var i = 0; i < 70; i++) {
      var bit = document.createElement('div');
      bit.className = 'confetti-bit';
      bit.style.left = (Math.random() * 100) + 'vw';
      bit.style.background = colors[(Math.random() * colors.length) | 0];
      bit.style.animationDuration = (1.6 + Math.random() * 1.6) + 's';
      bit.style.animationDelay = (Math.random() * 0.5) + 's';
      bit.style.transform = 'rotate(' + (Math.random() * 360) + 'deg)';
      host.appendChild(bit);
      setTimeout(function (b) { return function () { b.remove(); }; }(bit), 4200);
    }
  }

  function toast(text, kind, actionLabel, actionFn) {
    var t = document.createElement('div');
    t.className = 'toast' + (kind ? ' ' + kind : '');
    t.textContent = text;
    if (actionLabel) {
      var b = document.createElement('button');
      b.className = 'btn tiny';
      b.textContent = actionLabel;
      b.onclick = function () { actionFn(); t.remove(); };
      t.appendChild(b);
    }
    $('toasts').appendChild(t);
    setTimeout(function () { t.remove(); }, actionLabel ? 9000 : 3600);
  }

  function show(screen) {
    var els = document.querySelectorAll('.screen');
    for (var i = 0; i < els.length; i++) els[i].classList.remove('active');
    $('screen-' + screen).classList.add('active');
  }

  function me() {
    return {
      name: state.name,
      shape: state.authed && state.profile ? state.profile.shape : 'sq',
      trail: state.authed && state.profile ? state.profile.trail : 't0',
    };
  }

  function coinDisplay() {
    $('coin-count').textContent = state.authed && state.profile ? state.profile.coins : state.wallet;
  }

  function nameDisplay() {
    $('me-chip').textContent = state.authed ? state.name : state.name + ' · guest';
  }

  function renderLeaderboard(list) {
    var grid = $('shop-grid');
    grid.innerHTML = '';
    grid.className = 'lb-list';
    if (!list || !list.length) {
      grid.innerHTML = '<div class="friend-empty">nobody has played yet — be the first</div>';
      return;
    }
    for (var i = 0; i < list.length; i++) {
      var row = document.createElement('div');
      row.className = 'lb-row' + (state.authed && list[i].n === state.name ? ' me' : '');
      row.innerHTML = '<span class="lb-pos">' + (i + 1) + '</span>' +
        '<span class="lb-name">' + escapeHtml(list[i].n) + '</span>' +
        '<span class="lb-stats">' + list[i].w + ' wins · ' + list[i].p + ' plays</span>';
      grid.appendChild(row);
    }
  }

  function renderShop() {
    var grid = $('shop-grid');
    grid.className = 'shop-grid';
    if (state.shopTab === 'top') {
      net.send(4, { e: 'top' });
      grid.innerHTML = '<div class="friend-empty">loading…</div>';
      return;
    }
    if (!state.profile) return;
    var authbox = $('account-auth');
    var panel = $('account-panel');
    if (state.authed) {
      authbox.classList.add('hidden');
      panel.classList.remove('hidden');
      $('account-title').textContent = state.profile.name;
      $('account-stats').innerHTML =
        '<div><b>' + state.profile.coins + '</b>coins</div>' +
        '<div><b>' + state.profile.stats.plays + '</b>plays</div>' +
        '<div><b>' + state.profile.stats.wins + '</b>wins</div>';
      renderShop();
      sendWatch();
      renderFriends();
    } else {
      authbox.classList.remove('hidden');
      panel.classList.add('hidden');
    }
    coinDisplay();
    nameDisplay();
  }

  function parseItems(items) {
    var out = [];
    for (var i = 0; i < items.length; i++) {
      var parts = items[i].split(':');
      out.push({ k: parts[0] === 't' ? 'trail' : 'shape', id: parts.slice(1).join(':') });
    }
    return out;
  }

  function shopCatalog(kind) {
    return kind === 'trail' ? ITEMS.TRAILS : ITEMS.SHAPES;
  }

  function renderShop() {
    if (!state.profile) return;
    var grid = $('shop-grid');
    grid.innerHTML = '';
    var list = shopCatalog(state.shopTab);
    var equipped = state.shopTab === 'trail' ? state.profile.trail : state.profile.shape;
    var owned = parseItems(state.profile.items);
    for (var i = 0; i < list.length; i++) {
      (function (it) {
        var isOwned = it.price === 0 || owned.some(function (o) { return o.k === state.shopTab && o.id === it.id; });
        var b = document.createElement('button');
        b.className = 'shop-item' + (it.id === equipped ? ' equipped' : '');
        var label = it.price === 0 ? 'free' : isOwned ? 'owned' : it.price + ' ¢';
        b.innerHTML = '<div class="si-icon">' + (state.shopTab === 'shape' ? '◆' : '➤') + '</div>' +
          '<div class="si-name">' + it.name + '</div>' +
          '<div class="si-price' + (isOwned ? ' owned' : '') + '">' + (it.id === equipped ? 'EQUIPPED' : label) + '</div>';
        b.onclick = function () {
          if (it.id === equipped) return;
          if (isOwned) net.send(4, { e: 'equip', k: state.shopTab, id: it.id });
          else net.send(4, { e: 'buy', k: state.shopTab, id: it.id });
        };
        grid.appendChild(b);
      })(list[i]);
    }
  }

  function openModal(id) { $(id).classList.remove('hidden'); }
  function closeModal(id) { $(id).classList.add('hidden'); }

  function loadManifest(cb) {
    fetch('/games.json', { cache: 'no-cache' }).then(function (r) { return r.json(); }).then(function (m) {
      state.manifest = m;
      VP.ASSET_V = m.v;
      cb(null, m);
    }).catch(function (err) { cb(err); });
  }

  function totalSize() {
    if (!state.manifest) return 0;
    var sum = 0;
    for (var i = 0; i < state.manifest.games.length; i++) sum += state.manifest.games[i].gzip;
    return sum;
  }

  function kb(n) { return (n / 1024).toFixed(0) + ' KB'; }

  function renderLibrary() {
    var grid = $('library-grid');
    grid.innerHTML = '';
    for (var i = 0; i < state.manifest.games.length; i++) {
      (function (g) {
        var b = document.createElement('button');
        b.className = 'game-card' + (VP.engine.isLoaded(g.id) ? ' loaded' : '');
        b.innerHTML = '<div class="gc-icon">' + g.icon + '</div>' +
          '<div class="gc-name">' + g.name + '</div>' +
          '<div class="gc-desc">' + g.desc + '</div>' +
          '<div class="gc-meta">' + g.min + '-' + g.max + ' players · ' + kb(g.gzip) + (VP.engine.isLoaded(g.id) ? ' · loaded' : ' · tap to load') + '</div>';
        b.onclick = function () { openStart(g); };
        grid.appendChild(b);
      })(state.manifest.games[i]);
    }
  }

  function openLibrary() {
    if (!state.manifest) {
      loadManifest(function () { openLibrary(); });
      return;
    }
    if (!state.loadMode) {
      $('loadmode-size').textContent = kb(totalSize());
      openModal('modal-loadmode');
      show('library');
      renderLibrary();
      return;
    }
    show('library');
    renderLibrary();
    if (state.loadMode === 'all') loadAll();
  }

  function loadAll() {
    var games = state.manifest.games;
    var done = 0;
    for (var i = 0; i < games.length; i++) {
      (function (g) {
        VP.engine.loadGame(g.id, function () {
          done++;
          $('lib-progress').textContent = done < games.length ? 'loading ' + done + ' / ' + games.length : done + ' games ready';
          if (done >= games.length) {
            renderLibrary();
            setTimeout(function () { $('lib-progress').textContent = ''; }, 2500);
          }
        });
      })(games[i]);
    }
  }

  function openStart(g) {
    state.pendingGame = g;
    $('start-head').textContent = g.icon + ' ' + g.name;
    $('start-desc').textContent = g.desc;
    $('start-instr').textContent = g.instr;
    setBots(state.botCount);
    openModal('modal-start');
  }

  function setBots(n) {
    state.botCount = n;
    var opts = document.querySelectorAll('.bot-opt');
    for (var i = 0; i < opts.length; i++) {
      opts[i].classList.toggle('active', parseInt(opts[i].getAttribute('data-n'), 10) === n);
    }
  }

  function ensureRoom(cb) {
    if (state.room) return cb();
    net.send(3, { e: 'create' });
    var wait = setInterval(function () {
      if (state.room) { clearInterval(wait); cb(); }
    }, 60);
    setTimeout(function () { clearInterval(wait); }, 4000);
  }

  function startMode(mode) {
    var g = state.pendingGame;
    if (!g) return;
    closeModal('modal-start');
    if (mode === 'online') {
      ensureRoom(function () {
        state.lastPicked = g.id;
        net.send(3, { e: 'pick', g: g.id });
        show('room');
        renderRoom();
        $('room-hint').textContent = 'share the code — add bots or wait for friends, then hit start';
      });
      return;
    }
    var bots = mode === '2p' ? Math.min(state.botCount, 2) : state.botCount;
    show('game');
    VP.engine.attach($('game-canvas'));
    VP.engine.fitCanvas();
    $('game-name-label').textContent = g.name.toUpperCase();
    $('conn-status').textContent = mode === '2p' ? 'LOCAL · 2P' : 'LOCAL · SOLO';
    VP.engine.startLocal(g.id, mode, bots, me(), onLocalEnd);
  }

  function onLocalEnd(result) {
    var pos = result.rank ? result.rank.indexOf(1) : 0;
    var reward = (RANK_REWARDS[pos] !== undefined ? RANK_REWARDS[pos] : 10) + PLAY_BONUS;
    state.wallet += reward;
    saveWallet();
    coinDisplay();
    showResults(result, reward, true);
  }

  function showResults(result, reward, local) {
    state.lastResult = { result: result, local: local };
    var iWon = result.w !== null && (result.w === state.myPid || (local && result.w === 1));
    if (iWon) {
      snd('win');
      confetti();
    } else {
      snd('lose');
    }
    var names = {};
    var view = VP.engine.E.mode === 'local' && VP.engine.E.st ? VP.engine.E.st.p : null;
    if (view) for (var k in view) names[k] = view[k].name;
    if (state.room) {
      for (var i = 0; i < state.room.players.length; i++) names[state.room.players[i].i] = state.room.players[i].n;
    }
    var title = result.w === null ? 'DRAW' : (iWon ? 'YOU WIN' : (names[result.w] || 'PLAYER') + ' WINS');
    if (result.w !== null && !local && state.room) {
      var winnerRow = state.room.players.filter(function (p) { return p.i === result.w; })[0];
      if (winnerRow && winnerRow.bot) title = winnerRow.n + ' WINS';
    }
    $('results-title').textContent = title;
    var list = $('results-list');
    list.innerHTML = '';
    var rank = result.rank || [];
    for (var j = 0; j < rank.length; j++) {
      var pid = rank[j];
      var row = document.createElement('div');
      row.className = 'results-row' + (j === 0 ? ' winner' : '');
      var sc = result.sc && result.sc[pid] !== undefined ? ' · ' + result.sc[pid] : '';
      row.innerHTML = '<span class="rr-pos">' + (j + 1) + '</span><span>' + (names[pid] || 'Player ' + pid) + sc + '</span>';
      list.appendChild(row);
    }
    $('results-reward').textContent = reward !== null ? '+' + reward + ' coins' : '';
    $('btn-again').classList.remove('hidden');
    $('btn-results-lobby').classList.toggle('hidden', !state.room);
    $('btn-results-menu').classList.remove('hidden');
    $('results').classList.remove('hidden');
  }

  function hideResults() {
    $('results').classList.add('hidden');
  }

  function renderRoom() {
    if (!state.room) return;
    $('room-code').textContent = state.room.code;
    $('room-phase').textContent = state.room.phase === 'playing' ? 'IN PLAY' : state.room.phase.toUpperCase();
    var box = $('room-players');
    box.innerHTML = '';
    for (var i = 0; i < state.room.players.length; i++) {
      (function (p) {
        var row = document.createElement('div');
        row.className = 'player-row';
        var colors = VP.S.COLORS;
        var dot = '<span class="pr-slot" style="background:' + colors[(p.s - 1) % 4] + ';color:' + colors[(p.s - 1) % 4] + '"></span>';
        row.innerHTML = dot + '<span class="pr-name">' + escapeHtml(p.n) + '</span>' +
          (p.bot ? '<span class="pr-bot">BOT</span>' : '') +
          (p.i === state.room.host ? '<span class="pr-host">HOST</span>' : '') +
          (p.i === state.myPid ? '<span class="pr-bot">YOU</span>' : '');
        box.appendChild(row);
      })(state.room.players[i]);
    }
    var gameName = state.room.game ? gameById(state.room.game) : null;
    $('room-game-name').textContent = gameName ? gameName.icon + ' ' + gameName.name : 'no game picked yet — open the library to choose one';
    var isHost = state.myPid === state.room.host;
    $('btn-start').disabled = !isHost;
    $('btn-bot-add').disabled = !isHost;
    $('btn-bot-del').disabled = !isHost;
    var min = gameName ? gameName.min : 2;
    $('btn-start').textContent = state.room.players.length < min ? 'START (NEED ' + min + ')' : 'START';
    $('room-hint').textContent = isHost ? '' : 'waiting for the host to start…';
  }

  function gameById(id) {
    if (!state.manifest) return null;
    for (var i = 0; i < state.manifest.games.length; i++) {
      if (state.manifest.games[i].id === id) return state.manifest.games[i];
    }
    return null;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function chatLine(name, text, color) {
    var log = $('chat-log');
    var div = document.createElement('div');
    div.innerHTML = '<span class="cl-name" style="color:' + (color || '#00fff2') + '">' + escapeHtml(name) + '</span> ' + escapeHtml(text);
    log.appendChild(div);
    while (log.children.length > 60) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
    VP.engine.pushChat(name + ': ' + text);
  }

  function pickGameFromRoom() {
    if (!state.manifest) return;
    openLibrary();
  }

  function renderFriends() {
    var list = $('friend-list');
    list.innerHTML = '';
    if (!state.authed || !state.profile) {
      list.innerHTML = '<div class="friend-empty">log in to<br>see your friends</div>';
      return;
    }
    var friends = state.profile.friends;
    if (!friends.length) {
      list.innerHTML = '<div class="friend-empty">no friends yet<br>add one from your account</div>';
      return;
    }
    for (var i = 0; i < friends.length; i++) {
      (function (key) {
        var pres = state.friends[key] || [key, 0, null];
        var row = document.createElement('div');
        row.className = 'friend-row';
        row.innerHTML = '<span class="friend-dot' + (pres[1] ? ' on' : '') + '"></span>' +
          '<span class="friend-name">' + escapeHtml(pres[0]) + '</span>' +
          (pres[2] ? '<span class="friend-room">' + pres[2] + '</span>' : '');
        row.onclick = function () { friendMenu(key); };
        list.appendChild(row);
      })(friends[i]);
    }
  }

  function friendMenu(key) {
    var pres = state.friends[key] || [key, 0, null];
    var box = $('invite-list');
    box.innerHTML = '';
    var title = document.createElement('div');
    title.style.cssText = 'font-size:13px;font-weight:700;text-align:center;margin-bottom:4px';
    title.textContent = pres[0];
    box.appendChild(title);

    function addAction(label, fn) {
      var row = document.createElement('div');
      row.className = 'invite-row';
      row.innerHTML = '<span>' + label + '</span>';
      var b = document.createElement('button');
      b.className = 'btn tiny';
      b.textContent = 'GO';
      b.onclick = function () { closeModal('modal-invite'); fn(); };
      row.appendChild(b);
      box.appendChild(row);
    }

    if (state.room) addAction('invite to room ' + state.room.code, function () {
      net.send(4, { e: 'invite', to: pres[0] });
      toast('invite sent to ' + pres[0]);
    });
    if (pres[2]) addAction('join their room ' + pres[2], function () {
      net.send(3, { e: 'join', code: pres[2] });
    });
    addAction('quick play', function () {
      ensureRoom(function () {
        var games = state.manifest.games;
        var g = games[(Math.random() * games.length) | 0];
        net.send(3, { e: 'pick', g: g.id });
        net.send(4, { e: 'invite', to: pres[0], g: g.id });
        toast('invited ' + pres[0] + ' to ' + g.name, 'good');
        show('room');
        renderRoom();
      });
    });
    addAction('remove friend', function () {
      net.send(4, { e: 'fdel', n: pres[0] });
    });
    openModal('modal-invite');
  }

  function sendWatch() {
    if (state.authed && state.profile) {
      net.send(4, { e: 'watch', f: state.profile.friends });
    }
  }

  function renderTrade() {
    var sel = $('trade-target');
    sel.innerHTML = '';
    if (!state.room || !state.authed) return;
    var mine = state.profile ? parseItems(state.profile.items) : [];
    for (var i = 0; i < state.room.players.length; i++) {
      var p = state.room.players[i];
      if (p.bot || p.i === state.myPid) continue;
      var opt = document.createElement('option');
      opt.value = p.n;
      opt.textContent = p.n;
      sel.appendChild(opt);
    }
    var give = $('trade-give');
    give.innerHTML = '';
    give.dataset.sel = '';
    for (var g = 0; g < mine.length; g++) {
      (function (item) {
        var el = document.createElement('div');
        el.className = 'trade-item';
        el.textContent = itemName(item.k, item.id);
        el.onclick = function () {
          give.dataset.sel = item.k + ':' + item.id;
          var all = give.children;
          for (var q = 0; q < all.length; q++) all[q].classList.remove('sel');
          el.classList.add('sel');
        };
        give.appendChild(el);
      })(mine[g]);
    }
    if (!mine.length) give.innerHTML = '<div class="friend-empty">you own no items yet</div>';
    var want = $('trade-want');
    want.innerHTML = '';
    want.dataset.sel = '';
    var catalog = ITEMS.SHAPES.filter(function (s) { return s.price > 0; })
      .map(function (s) { return { k: 'shape', id: s.id }; })
      .concat(ITEMS.TRAILS.filter(function (t) { return t.price > 0; }).map(function (t) { return { k: 'trail', id: t.id }; }));
    for (var w = 0; w < catalog.length; w++) {
      (function (item) {
        var el = document.createElement('div');
        el.className = 'trade-item';
        el.textContent = itemName(item.k, item.id);
        el.onclick = function () {
          want.dataset.sel = item.k + ':' + item.id;
          var all = want.children;
          for (var q = 0; q < all.length; q++) all[q].classList.remove('sel');
          el.classList.add('sel');
        };
        want.appendChild(el);
      })(catalog[w]);
    }
  }

  function itemName(kind, id) {
    var it = ITEMS.find(kind, id);
    return (it ? it.name : id) + ' (' + kind + ')';
  }

  function bindUi() {
    var muteBtn = $('btn-mute');
    function refreshMute() {
      muteBtn.textContent = sound.muted() ? '🔇' : '🔊';
      muteBtn.classList.toggle('off', sound.muted());
    }
    muteBtn.onclick = function () { sound.toggle(); refreshMute(); };
    refreshMute();

    document.addEventListener('pointerdown', function () { if (sound.unlock) sound.unlock(); }, { once: true });

    document.addEventListener('click', function (ev) {
      var t = ev.target;
      while (t && t !== document.body) {
        if (t.classList && (t.classList.contains('btn') || t.classList.contains('game-card') ||
            t.classList.contains('shop-item') || t.classList.contains('bot-opt') ||
            t.classList.contains('auth-tab') || t.classList.contains('shop-tab') ||
            t.classList.contains('friend-row') || t.classList.contains('trade-item'))) {
          snd('click');
          break;
        }
        t = t.parentNode;
      }
    });

    $('btn-play').onclick = openLibrary;
    $('btn-create').onclick = function () { net.send(3, { e: 'create' }); };
    $('btn-join').onclick = function () {
      var code = $('join-code').value.trim().toUpperCase();
      if (code.length === 4) net.send(3, { e: 'join', code: code });
      else toast('enter the 4-letter room code', 'bad');
    };
    $('join-code').addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') $('btn-join').click();
    });
    $('btn-lib-back').onclick = function () { show('title'); };
    $('btn-account').onclick = function () {
      $('auth-msg').textContent = '';
      openModal('modal-account');
    };
    document.querySelectorAll('.modal-close').forEach(function (b) {
      b.onclick = function () { closeModal(b.getAttribute('data-close')); };
    });
    document.querySelectorAll('.modal').forEach(function (m) {
      m.addEventListener('click', function (ev) { if (ev.target === m) m.classList.add('hidden'); });
    });

    $('tab-login').onclick = function () { authTab('login'); };
    $('tab-signup').onclick = function () { authTab('signup'); };
    $('btn-auth-go').onclick = doAuth;
    $('auth-pass').addEventListener('keydown', function (ev) { if (ev.key === 'Enter') doAuth(); });

    $('btn-load-all').onclick = function () {
      state.loadMode = 'all';
      lsSet('vp.loadMode', 'all');
      closeModal('modal-loadmode');
      loadAll();
    };
    $('btn-load-manual').onclick = function () {
      state.loadMode = 'manual';
      lsSet('vp.loadMode', 'manual');
      closeModal('modal-loadmode');
    };

    document.querySelectorAll('.bot-opt').forEach(function (b) {
      b.onclick = function () { setBots(parseInt(b.getAttribute('data-n'), 10)); };
    });
    $('btn-mode-solo').onclick = function () { startMode('solo'); };
    $('btn-mode-2p').onclick = function () { startMode('2p'); };
    $('btn-mode-online').onclick = function () { startMode('online'); };

    $('btn-room-leave').onclick = function () {
      snd('back');
      net.send(3, { e: 'leave' });
      state.room = null;
      state.lastRoomCode = null;
      show('title');
    };
    $('btn-bot-add').onclick = function () { net.send(3, { e: 'botadd' }); };
    $('btn-bot-del').onclick = function () { net.send(3, { e: 'botdel' }); };
    $('btn-trade').onclick = function () {
      if (!state.authed) return toast('log in to trade items', 'bad');
      if (!state.room) return;
      renderTrade();
      openModal('modal-trade');
    };
    $('btn-trade-send').onclick = function () {
      var target = $('trade-target').value;
      var give = $('trade-give').dataset.sel;
      var want = $('trade-want').dataset.sel;
      if (!target || !give || !want) return toast('pick both sides of the trade', 'bad');
      var gp = give.split(':');
      var wp = want.split(':');
      net.send(3, { e: 'trade', to: target, give: { k: gp[0], id: gp[1] }, want: { k: wp[0], id: wp[1] } });
      closeModal('modal-trade');
      toast('offer sent to ' + target);
    };
    $('btn-offer-accept').onclick = function () {
      net.send(3, { e: 'tradeok' });
      closeModal('modal-offer');
    };
    $('btn-offer-decline').onclick = function () {
      net.send(3, { e: 'tradeno' });
      closeModal('modal-offer');
    };

    $('room-game-name').style.cursor = 'pointer';
    $('room-game-name').onclick = pickGameFromRoom;

    $('btn-start').onclick = function () { net.send(3, { e: 'start' }); };
    $('chat-input').addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter') return;
      var text = ev.target.value.trim();
      if (text) net.send(4, { e: 'chat', t: text });
      ev.target.value = '';
    });

    document.querySelectorAll('.shop-tab').forEach(function (b) {
      b.onclick = function () {
        state.shopTab = b.getAttribute('data-shop');
        document.querySelectorAll('.shop-tab').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        renderShop();
      };
    });
    $('btn-logout').onclick = function () {
      lsSet('vp.token', '');
      state.token = null;
      net.send(4, { e: 'logout' });
    };

    $('btn-game-exit').onclick = function () {
      snd('back');
      VP.engine.stop();
      net.stopInputs();
      hideResults();
      if (state.room) net.send(3, { e: 'leave' });
      state.room = null;
      state.lastRoomCode = null;
      show('title');
    };
    $('btn-again').onclick = function () {
      hideResults();
      VP.engine.stop();
      if (state.room) {
        net.send(3, { e: 'again' });
        show('game');
      } else {
        startMode('solo');
      }
    };
    $('btn-results-lobby').onclick = function () {
      hideResults();
      VP.engine.stop();
      if (state.room) { show('room'); renderRoom(); }
      else show('title');
    };
    $('btn-results-menu').onclick = function () {
      hideResults();
      VP.engine.stop();
      show('title');
    };

    window.addEventListener('resize', VP.engine.fitCanvas);
  }

  var authMode = 'login';

  function authTab(mode) {
    authMode = mode;
    $('tab-login').classList.toggle('active', mode === 'login');
    $('tab-signup').classList.toggle('active', mode === 'signup');
    $('btn-auth-go').textContent = mode === 'login' ? 'LOG IN' : 'CREATE ACCOUNT';
    $('auth-msg').textContent = '';
  }

  function doAuth() {
    var n = $('auth-name').value.trim();
    var p = $('auth-pass').value;
    if (!n || !p) { $('auth-msg').textContent = 'fill in both fields'; $('auth-msg').className = 'auth-msg bad'; return; }
    if (authMode === 'login') net.send(4, { e: 'login', n: n, p: p });
    else net.send(4, { e: 'signup', n: n, p: p });
  }

  function onAuthOk(msg) {
    snd('join');
    state.authed = true;
    state.profile = msg.profile;
    state.name = msg.name;
    state.token = msg.token;
    lsSet('vp.token', msg.token);
    if (state.wallet > 0) {
      net.send(4, { e: 'claim', c: state.wallet });
    }
    setAccountUi();
    closeModal('modal-account');
    toast('logged in as ' + msg.name, 'good');
  }

  function onProfile(profile) {
    state.profile = profile;
    setAccountUi();
  }

  function bindNet() {
    net.on(2, function (msg) {
      if (msg && VP.engine.E.mode === 'remote') VP.engine.applyState(msg);
    });

    net.on(3, function (msg) {
      switch (msg.e) {
        case 'created':
        case 'joined':
          snd('join');
          state.room = msg.room;
          state.lastRoomCode = msg.room.code;
          state.myPid = msg.you;
          show('room');
          renderRoom();
          break;
        case 'update':
          if (state.room && msg.room && msg.room.code === state.room.code) {
            var wasPlaying = state.room.phase === 'playing';
            state.room = msg.room;
            if (!wasPlaying) renderRoom();
            else if (document.getElementById('screen-room').classList.contains('active')) renderRoom();
          }
          break;
        case 'started':
          state.room = msg.room;
          state.lastRoomCode = msg.room.code;
          snd('start');
          show('game');
          hideResults();
          VP.engine.attach($('game-canvas'));
          VP.engine.fitCanvas();
          $('game-name-label').textContent = (msg.config ? msg.config.name : msg.game).toUpperCase();
          $('conn-status').textContent = 'ONLINE';
          VP.engine.startRemote(msg.game, msg.config, state.myPid);
          net.startInputs(VP.engine.netKeys);
          break;
        case 'ended':
          state.room = msg.room;
          VP.engine.stop();
          net.stopInputs();
          showResults(msg.result, null, false);
          break;
        case 'left':
          state.room = null;
          VP.engine.stop();
          net.stopInputs();
          show('title');
          break;
        case 'error':
          toast(msg.msg, 'bad');
          break;
        case 'trade': {
          $('offer-body').innerHTML = '<b>' + escapeHtml(msg.from) + '</b> offers you <b>' + escapeHtml(itemName(msg.give.k, msg.give.id)) + '</b> for your <b>' + escapeHtml(itemName(msg.want.k, msg.want.id)) + '</b>';
          openModal('modal-offer');
          break;
        }
        case 'tradeno':
          toast('trade declined', 'bad');
          break;
        case 'traded':
          snd('trade');
          toast('trade complete', 'good');
          break;
        default: break;
      }
    });

    net.on(4, function (msg) {
      switch (msg.e) {
        case 'hello':
          if (!state.authed) {
            state.name = msg.name;
            nameDisplay();
          }
          break;
        case 'auth':
          if (msg.ok) onAuthOk(msg);
          else {
            $('auth-msg').textContent = msg.msg || 'failed';
            $('auth-msg').className = 'auth-msg bad';
            if (msg.msg && msg.msg.indexOf('expired') >= 0) {
              lsSet('vp.token', '');
              state.token = null;
            }
          }
          break;
        case 'profile':
          onProfile(msg.profile);
          break;
        case 'buy':
        case 'equip':
          if (msg.ok && msg.profile) onProfile(msg.profile);
          if (!msg.ok) toast(msg.msg, 'bad');
          break;
        case 'claim':
          if (msg.ok) {
            state.wallet = 0;
            saveWallet();
            if (msg.profile) onProfile(msg.profile);
          }
          break;
        case 'reward':
          snd('coin');
          toast('+' + msg.coins + ' coins' + (msg.won ? ' · winner!' : ''), 'good');
          if (state.authed && state.profile) state.profile.coins = msg.total;
          coinDisplay();
          break;
        case 'friends':
          if (msg.ok && msg.profile) onProfile(msg.profile);
          else if (!msg.ok) toast(msg.msg, 'bad');
          break;
        case 'presence':
          for (var i = 0; i < msg.f.length; i++) {
            state.friends[msg.f[i][0]] = msg.f[i];
          }
          renderFriends();
          break;
        case 'top':
          if (state.shopTab === 'top' && !$('modal-account').classList.contains('hidden')) {
            renderLeaderboard(msg.list);
          }
          break;
        case 'chat':
          snd('msg');
          chatLine(msg.n, msg.t);
          break;
        case 'invite':
          toast(msg.from + ' invited you to room ' + msg.code, 'good', 'JOIN', function () {
            net.send(3, { e: 'join', code: msg.code });
          });
          break;
        case 'logout':
          state.authed = false;
          state.profile = null;
          state.name = msg.guest || 'Guest';
          state.token = null;
          setAccountUi();
          renderFriends();
          break;
        case 'error':
          toast(msg.msg, 'bad');
          break;
        default: break;
      }
    });

    net.on('open', function () {
      $('conn-status').textContent = 'ONLINE';
      if (state.token) net.send(4, { e: 'login', token: state.token });
      sendWatch();
      if (state.lastRoomCode) {
        var code = state.lastRoomCode;
        state.lastRoomCode = null;
        net.send(3, { e: 'join', code: code });
      }
    });
    net.on('close', function () {
      $('conn-status').textContent = 'RECONNECTING…';
      state.room = null;
      if (VP.engine.E.mode === 'remote') {
        VP.engine.stop();
        net.stopInputs();
        show('title');
        toast('connection lost — rejoining your room…', 'bad');
      }
    });

    net.connect();
  }

  function boot() {
    bindUi();
    bindNet();
    loadManifest(function (err) {
      if (err) toast('could not load the game list', 'bad');
    });
    setAccountUi();
    show('title');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  VP.lobby = { state: state };
})(typeof self !== 'undefined' ? self : globalThis);
