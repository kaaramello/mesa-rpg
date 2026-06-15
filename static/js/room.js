// ===================== INIT =====================
const ROOM_ID = window.ROOM_ID;
const playerName = sessionStorage.getItem('player_name') || 'Jogador';
const isGM = sessionStorage.getItem('is_gm') === '1';

function getSessionToken() {
  let t = sessionStorage.getItem('rpg_session_token');
  if (!t) {
    t = 'tk-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    sessionStorage.setItem('rpg_session_token', t);
  }
  return t;
}
const SESSION_TOKEN = getSessionToken();

if (!isGM) document.body.classList.add('not-gm');
if (isGM) document.body.classList.add('is-gm');

// ===================== SOCKET =====================
const socket = io({ transports: ['websocket', 'polling'] });

socket.on('connect', () => {
  socket.emit('join', { room_id: ROOM_ID, player_name: playerName, is_gm: isGM, token: SESSION_TOKEN });
  if (!isGM) {
    const savedSheet = JSON.parse(localStorage.getItem('rpg_sheet_v2') || 'null');
    if (savedSheet) {
      socket.emit('share_sheet', { room_id: ROOM_ID, sheet: savedSheet });
    }
  }
});

socket.on('kicked', (data) => {
  alert('Você foi desconectado: ' + (data.reason || 'Sessão encerrada.'));
  window.location.href = '/';
});

// ===================== PLAYER LIST =====================
let players = {};
const PLAYER_COLORS = ['#7c6af7','#e94560','#4caf50','#ff9800','#2196F3','#00bcd4','#9c27b0','#ff5722'];

function playerColor(sid) {
  const keys = Object.keys(players);
  const idx = keys.indexOf(sid);
  return PLAYER_COLORS[idx % PLAYER_COLORS.length];
}

socket.on('player_list', (list) => {
  players = list;
  renderPlayers();
  updateNavAvatar();
  const badge = document.getElementById('player-badge');
  if (badge) badge.textContent = Object.keys(list).length + ' online';
});

function renderPlayers() {
  const el = document.getElementById('players-list');
  if (!el) return;
  el.innerHTML = '';
  const count = Object.keys(players).length;
  const countEl = document.getElementById('mobile-online-count');
  if (countEl) countEl.textContent = count;
  for (const [sid, p] of Object.entries(players)) {
    const color = playerColor(sid);
    const v = p.vitals || {};
    const vidaPct  = v.vida_max  ? Math.min(100, Math.round((v.vida  || 0) / v.vida_max  * 100)) : 0;
    const sanPct   = v.sanidade_max ? Math.min(100, Math.round((v.sanidade || 0) / v.sanidade_max * 100)) : 0;
    const enPct    = v.energia_max  ? Math.min(100, Math.round((v.energia  || 0) / v.energia_max  * 100)) : 0;
    const avatarHtml = v.avatar
      ? `<img src="${v.avatar}" alt="">`
      : `<span>${(p.name || '?')[0].toUpperCase()}</span>`;
    const gmBadge = p.is_gm ? '<span class="pc-gm-badge">GM</span>' : '';
    const charName = v.char_name ? `<div class="pc-char">${v.char_name}</div>` : '';
    const vidaMax = v.vida_max || 0;
    const sanMax  = v.sanidade_max || 0;
    const enMax   = v.energia_max || 0;
    const vitalsHtml = p.is_gm ? '' : `
      <div class="pc-vitals">
        <div class="pc-bar-row"><span class="pc-bar-icon">❤️</span><div class="pc-bar-wrap${vidaMax ? '' : ' empty'}"><div class="pc-bar-fill vida" style="width:${vidaPct}%"></div></div><span class="pc-bar-val">${v.vida||0}/${vidaMax||'—'}</span></div>
        <div class="pc-bar-row"><span class="pc-bar-icon">🧠</span><div class="pc-bar-wrap${sanMax ? '' : ' empty'}"><div class="pc-bar-fill sanidade" style="width:${sanPct}%"></div></div><span class="pc-bar-val">${v.sanidade||0}/${sanMax||'—'}</span></div>
        <div class="pc-bar-row"><span class="pc-bar-icon">⚡</span><div class="pc-bar-wrap${enMax ? '' : ' empty'}"><div class="pc-bar-fill energia" style="width:${enPct}%"></div></div><span class="pc-bar-val">${v.energia||0}/${enMax||'—'}</span></div>
      </div>`;
    const actionsHtml = isGM && !p.is_gm ? `
      <div class="pc-actions">
        <button class="pc-action-btn" onclick="requestPlayerSheet('${sid}')">📋 Ficha</button>
        <button class="pc-action-btn" onclick="editPlayerVitals('${sid}')">✏️ Vitais</button>
      </div>` : '';
    const card = document.createElement('div');
    card.className = 'player-card';
    card.dataset.sid = sid;
    card.innerHTML = `
      <div class="pc-header">
        <div class="pc-avatar" style="background:${color}">${avatarHtml}</div>
        <div class="pc-info">
          <div class="pc-name">${p.name}</div>
          ${charName}
        </div>
        ${gmBadge}
      </div>
      ${vitalsHtml}
      ${actionsHtml}`;
    el.appendChild(card);
  }
}

function updateNavAvatar() {
  const el = document.getElementById('nav-avatar');
  if (!el) return;
  const mySid = socket.id;
  const me = players[mySid];
  if (me?.vitals?.avatar) {
    el.innerHTML = `<img src="${me.vitals.avatar}" alt="">`;
  } else {
    el.textContent = (playerName || '?')[0].toUpperCase();
  }
  for (const [sid, _p] of Object.entries(players)) {
    if (_p.token === SESSION_TOKEN || sid === socket.id) {
      el.style.background = playerColor(sid);
      break;
    }
  }
}

// ===================== MOBILE PANEL =====================
function toggleMobilePanel() {
  const panel = document.getElementById('right-panel');
  const overlay = document.getElementById('mobile-overlay');
  const isOpen = panel.classList.toggle('open');
  overlay.classList.toggle('active', isOpen);
}

// ===================== VIEW SWITCHING =====================
function switchView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-btn[data-view]').forEach(b => b.classList.remove('active'));
  const view = document.getElementById('view-' + name);
  if (view) view.classList.add('active');
  const btn = document.querySelector(`.nav-btn[data-view="${name}"]`);
  if (btn) btn.classList.add('active');
  const mapToolbar = document.getElementById('map-toolbar');
  if (mapToolbar) mapToolbar.style.display = name === 'map' ? 'flex' : 'none';
  if (name === 'map') initMap();
}

// ===================== CHAT =====================
document.getElementById('room-id-display').textContent = ROOM_ID;

socket.on('room_state', (data) => {
  for (const msg of (data.messages || [])) appendMessage(msg);
  if (data.map) applyMapState(data.map);
  if (data.tokens) {
    for (const tok of Object.values(data.tokens)) spawnToken(tok);
  }
  if (data.pins) {
    for (const [id, pin] of Object.entries(data.pins)) pins[id] = pin;
    if (mapInited) drawMap();
  }
});

let _msgHandler = null;
if (_msgHandler) socket.off('new_message', _msgHandler);
_msgHandler = (msg) => {
  appendMessage(msg);
  if (msg.type === 'roll') showDice3D(msg.total, msg.rolls?.[0] || msg.total, msg.author);
  if (msg.type === 'roll') addDiceHistory(msg);
};
socket.on('new_message', _msgHandler);

let _atBottom = true;
let _unreadCount = 0;

function _addPinBtn(row, text, author) {
  if (!isGM) return;
  const actions = document.createElement('div');
  actions.className = 'msg-actions';
  const btn = document.createElement('button');
  btn.className = 'msg-pin-btn';
  btn.textContent = '📌';
  btn.title = 'Repostar como destaque';
  btn.addEventListener('click', () => repostMsg(text, author));
  actions.appendChild(btn);
  row.appendChild(actions);
}

function appendMessage(msg) {
  const list = document.getElementById('messages-list');
  if (!list) return;
  if (msg.type === 'system') {
    const el = document.createElement('div');
    el.className = 'msg-system';
    el.textContent = msg.text;
    list.appendChild(el);
    scrollMessages();
    return;
  }
  if (msg.type === 'highlight') {
    const row = document.createElement('div');
    row.className = 'msg-highlight';
    const safeText = (msg.text || '').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const safeOrig = (msg.origAuthor || '').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    row.innerHTML = `<div class="msg-highlight-label">📌 Destaque por ${msg.author}</div><div class="msg-highlight-orig">originalmente de <strong>${safeOrig}</strong></div><div class="msg-highlight-text">${safeText}</div>`;
    list.appendChild(row);
    scrollMessages();
    return;
  }
  const row = document.createElement('div');
  const authorColor = getAuthorColor(msg.author);
  const time = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  if (msg.type === 'narrador') {
    row.className = 'msg-narrador';
    const safeText = (msg.text || '').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    row.innerHTML = `<em class="narrador-text">${safeText}</em>`;
    _addPinBtn(row, msg.text, msg.realAuthor || msg.author);
    list.appendChild(row);
    scrollMessages();
    return;
  }
  if (msg.type === 'roll') {
    const boldText = msg.text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    row.className = 'msg-row msg-roll';
    row.innerHTML = `
      <div class="msg-avatar" style="background:${authorColor}">${(msg.author||'?')[0].toUpperCase()}</div>
      <div class="msg-content">
        <div class="msg-header">
          <span class="msg-author" style="color:${authorColor}">${msg.author}</span>
          <span class="msg-time">${time}</span>
        </div>
        <div class="msg-body">${boldText}</div>
      </div>`;
  } else if (msg.type === 'persona') {
    const realColor = getAuthorColor(msg.realAuthor || msg.author);
    row.className = 'msg-row msg-persona';
    const safeText = (msg.text || '').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    row.innerHTML = `
      <div class="msg-avatar" style="background:${realColor};font-size:18px">🎭</div>
      <div class="msg-content">
        <div class="msg-header">
          <span class="msg-author" style="color:#ff9800">${msg.author}</span>
          <span class="msg-time">${time}</span>
        </div>
        <div class="msg-body" style="font-style:italic">${safeText}</div>
      </div>`;
  } else if (msg.type === 'file') {
    const isImg = msg.filetype && msg.filetype.startsWith('image/');
    const bodyHtml = isImg
      ? `<img src="${msg.filedata}" class="msg-img" alt="${msg.filename}" onclick="window.open(this.src)">`
      : `<a class="msg-file-link" href="${msg.filedata}" download="${msg.filename}">📎 ${msg.filename}</a>`;
    row.className = 'msg-row';
    row.innerHTML = `
      <div class="msg-avatar" style="background:${authorColor}">${(msg.author||'?')[0].toUpperCase()}</div>
      <div class="msg-content">
        <div class="msg-header">
          <span class="msg-author" style="color:${authorColor}">${msg.author}</span>
          <span class="msg-time">${time}</span>
        </div>
        <div class="msg-body">${bodyHtml}</div>
      </div>`;
  } else {
    row.className = 'msg-row';
    const safeText = (msg.text || '').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    row.innerHTML = `
      <div class="msg-avatar" style="background:${authorColor}">${(msg.author||'?')[0].toUpperCase()}</div>
      <div class="msg-content">
        <div class="msg-header">
          <span class="msg-author" style="color:${authorColor}">${msg.author}</span>
          <span class="msg-time">${time}</span>
        </div>
        <div class="msg-body">${safeText}</div>
      </div>`;
  }
  _addPinBtn(row, msg.text, msg.author);
  list.appendChild(row);
  scrollMessages();
}

function getAuthorColor(author) {
  for (const [sid, p] of Object.entries(players)) {
    if (p.name === author) return playerColor(sid);
  }
  let hash = 0;
  for (let i = 0; i < (author||'').length; i++) hash = author.charCodeAt(i) + ((hash << 5) - hash);
  return PLAYER_COLORS[Math.abs(hash) % PLAYER_COLORS.length];
}

function scrollMessages() {
  const area = document.getElementById('messages-area');
  if (!area) return;
  if (_atBottom) {
    area.scrollTop = area.scrollHeight;
  } else {
    _unreadCount++;
    const btn = document.getElementById('chat-scroll-down');
    const cnt = document.getElementById('chat-unread-count');
    if (btn) btn.classList.remove('hidden');
    if (cnt) cnt.textContent = _unreadCount;
  }
}

function jumpToBottom() {
  _atBottom = true;
  _unreadCount = 0;
  const area = document.getElementById('messages-area');
  if (area) area.scrollTop = area.scrollHeight;
  const btn = document.getElementById('chat-scroll-down');
  if (btn) btn.classList.add('hidden');
}

function repostMsg(text, origAuthor) {
  socket.emit('chat_message', {
    room_id: ROOM_ID,
    text: text,
    origAuthor: origAuthor,
    chat_type: 'highlight'
  });
}

let chatMode = 'normal';

function setChatMode(mode) {
  chatMode = mode;
  document.querySelectorAll('.chat-mode-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('mode-' + mode)?.classList.add('active');
  document.getElementById('persona-row').style.display = mode === 'persona' ? 'flex' : 'none';
}

function sendChat() {
  const input = document.getElementById('chat-input');
  const text = (input.value || '').trim();
  if (!text) return;
  if (chatMode === 'persona') {
    const persona = (document.getElementById('persona-name')?.value || '').trim();
    if (!persona) { document.getElementById('persona-name')?.focus(); return; }
    socket.emit('chat_message', { room_id: ROOM_ID, text, persona, chat_type: 'persona' });
  } else if (chatMode === 'narrador') {
    socket.emit('chat_message', { room_id: ROOM_ID, text, chat_type: 'narrador' });
  } else {
    socket.emit('chat_message', { room_id: ROOM_ID, text });
  }
  input.value = '';
}

function chatKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
}

function sendFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    socket.emit('file_message', {
      room_id: ROOM_ID, filename: file.name,
      filetype: file.type, filedata: e.target.result
    });
  };
  reader.readAsDataURL(file);
  event.target.value = '';
}

function copyRoomLink() {
  const url = window.location.href;
  navigator.clipboard.writeText(url).then(() => {
    const btn = document.querySelector('.copy-btn');
    const orig = btn.textContent;
    btn.textContent = '✓ Copiado!';
    setTimeout(() => btn.textContent = orig, 2000);
  });
}

// ===================== DICE =====================
let _diceOverlayTimer = null;

function rollDice(sides, count, mod) {
  const n = count || 1;
  const m = mod || 0;
  socket.emit('roll_dice', { room_id: ROOM_ID, dice: sides, count: n, modifier: m });
}

function rollCustom() {
  const sides = prompt('Quantas faces? (ex: 6, 12, 20)');
  if (!sides || isNaN(sides)) return;
  const countStr = prompt('Quantos dados? (padrão: 1)');
  const modStr = prompt('Modificador? (padrão: 0)');
  const count = parseInt(countStr) || 1;
  const mod = parseInt(modStr) || 0;
  socket.emit('roll_dice', { room_id: ROOM_ID, dice: parseInt(sides), count, modifier: mod });
}

function showDice3D(total, firstRoll, author) {
  const overlay = document.getElementById('dice-overlay');
  const cube = document.getElementById('dice-3d-cube');
  const resultEl = document.getElementById('dice-result-display');
  if (!overlay) return;

  overlay.classList.remove('hidden');
  resultEl.textContent = '';
  cube.classList.remove('rolling');

  requestAnimationFrame(() => {
    cube.classList.add('rolling');
  });

  if (_diceOverlayTimer) clearTimeout(_diceOverlayTimer);
  _diceOverlayTimer = setTimeout(() => {
    resultEl.textContent = total;
    _diceOverlayTimer = setTimeout(() => {
      overlay.classList.add('hidden');
      cube.classList.remove('rolling');
      _diceOverlayTimer = null;
    }, 1800);
  }, 850);
}

document.getElementById('dice-overlay').addEventListener('click', () => {
  document.getElementById('dice-overlay').classList.add('hidden');
  document.getElementById('dice-3d-cube').classList.remove('rolling');
  if (_diceOverlayTimer) { clearTimeout(_diceOverlayTimer); _diceOverlayTimer = null; }
});

function addDiceHistory(msg) {
  const hist = document.getElementById('dice-history');
  if (!hist) return;
  const entry = document.createElement('div');
  entry.className = 'hist-entry';
  const boldText = msg.text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  entry.innerHTML = `<strong>${msg.author}</strong> ${boldText}`;
  hist.insertBefore(entry, hist.firstChild);
  if (hist.children.length > 20) hist.lastChild.remove();
}

// ===================== MAPA =====================
let mapCanvas, mapCtx;
let mapState = { background: null, grid_size: 50, show_grid: true, grid_color: '#ffffff', grid_opacity: 0.15, grid_type: 'square', width: 3000, height: 2000 };
let mapOffset = { x: 0, y: 0 }, mapZoom = 1;
let mapBgImage = null;
let isPanning = false, panStart = { x: 0, y: 0 };
let currentTool = 'select';
let tokens = {};
let pins = {};
let selectedTokenId = null;
let draggingToken = null, dragOffX = 0, dragOffY = 0;
let contextMenuToken = null;
let contextMenuPin = null;
let pendingPinPos = null;
let selectedPinColor = '#FF9800';
let snapToGrid = true;
let mapInited = false;
let measureStart = null, measureEnd = null;

function initMap() {
  if (mapInited) { resizeCanvas(); return; }
  mapInited = true;
  mapCanvas = document.getElementById('map-canvas');
  mapCtx = mapCanvas.getContext('2d');
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  mapCanvas.addEventListener('mousedown', onMapMouseDown);
  mapCanvas.addEventListener('mousemove', onMapMouseMove);
  mapCanvas.addEventListener('mouseup', onMapMouseUp);
  mapCanvas.addEventListener('wheel', onMapWheel, { passive: false });
  mapCanvas.addEventListener('contextmenu', onMapContextMenu);
  document.addEventListener('click', hideContextMenu);
  document.getElementById('pin-label-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); confirmAddPin(); }
    if (e.key === 'Escape') closePinPopup();
  });
  drawMap();
}

function resizeCanvas() {
  if (!mapCanvas) return;
  const parent = mapCanvas.parentElement;
  mapCanvas.width = parent.clientWidth;
  mapCanvas.height = parent.clientHeight;
  drawMap();
}

function drawMap() {
  if (!mapCtx) return;
  const W = mapCanvas.width, H = mapCanvas.height;
  mapCtx.clearRect(0, 0, W, H);
  mapCtx.save();
  mapCtx.translate(mapOffset.x, mapOffset.y);
  mapCtx.scale(mapZoom, mapZoom);

  if (mapBgImage) {
    mapCtx.drawImage(mapBgImage, 0, 0, mapState.width, mapState.height);
  } else {
    mapCtx.fillStyle = '#0a0a12';
    mapCtx.fillRect(0, 0, mapState.width, mapState.height);
  }

  if (mapState.show_grid) drawGrid();

  mapCtx.restore();

  for (const pin of Object.values(pins)) drawPin(pin);
  for (const tok of Object.values(tokens)) drawToken(tok);
  if (currentTool === 'measure' && measureStart && measureEnd) drawMeasure();
}

function drawGrid() {
  const gs = mapState.grid_size;
  const color = mapState.grid_color || '#ffffff';
  const alpha = mapState.grid_opacity !== undefined ? mapState.grid_opacity : 0.15;
  mapCtx.strokeStyle = color;
  mapCtx.globalAlpha = alpha;
  mapCtx.lineWidth = 0.5 / mapZoom;
  if (mapState.grid_type === 'hex') {
    drawHexGrid(gs);
  } else {
    for (let x = 0; x <= mapState.width; x += gs) {
      mapCtx.beginPath(); mapCtx.moveTo(x, 0); mapCtx.lineTo(x, mapState.height); mapCtx.stroke();
    }
    for (let y = 0; y <= mapState.height; y += gs) {
      mapCtx.beginPath(); mapCtx.moveTo(0, y); mapCtx.lineTo(mapState.width, y); mapCtx.stroke();
    }
  }
  mapCtx.globalAlpha = 1;
}

function drawHexGrid(size) {
  const w = size * 2, h = Math.sqrt(3) * size;
  for (let row = 0; row * h < mapState.height + h; row++) {
    for (let col = 0; col * w * 0.75 < mapState.width + w; col++) {
      const cx = col * w * 0.75 + (row % 2 === 0 ? 0 : w * 0.375);
      const cy = row * h / 2;
      mapCtx.beginPath();
      for (let i = 0; i < 6; i++) {
        const angle = Math.PI / 180 * (60 * i - 30);
        const px = cx + size * Math.cos(angle), py = cy + size * Math.sin(angle);
        i === 0 ? mapCtx.moveTo(px, py) : mapCtx.lineTo(px, py);
      }
      mapCtx.closePath(); mapCtx.stroke();
    }
  }
}

function drawMeasure() {
  if (!measureStart || !measureEnd) return;
  // All coords in screen space (called after mapCtx.restore)
  const x1 = measureStart.x * mapZoom + mapOffset.x;
  const y1 = measureStart.y * mapZoom + mapOffset.y;
  const x2 = measureEnd.x * mapZoom + mapOffset.x;
  const y2 = measureEnd.y * mapZoom + mapOffset.y;

  mapCtx.save();
  // Dashed line
  mapCtx.strokeStyle = '#ff9800'; mapCtx.lineWidth = 2; mapCtx.setLineDash([8, 4]);
  mapCtx.beginPath(); mapCtx.moveTo(x1, y1); mapCtx.lineTo(x2, y2); mapCtx.stroke();
  mapCtx.setLineDash([]);
  // Endpoint circles
  mapCtx.fillStyle = '#ff9800';
  [{ x: x1, y: y1 }, { x: x2, y: y2 }].forEach(p => {
    mapCtx.beginPath(); mapCtx.arc(p.x, p.y, 4, 0, Math.PI * 2); mapCtx.fill();
  });
  // Distance calculation
  const dist = Math.round(Math.hypot(measureEnd.x - measureStart.x, measureEnd.y - measureStart.y) / mapState.grid_size * 10) / 10;
  const badge = document.getElementById('measure-display');
  if (badge) { badge.textContent = dist + ' q'; badge.style.display = 'inline'; }
  // Floating label near endpoint
  const label = dist + ' quadrados';
  mapCtx.font = 'bold 13px sans-serif';
  const lw = mapCtx.measureText(label).width + 14;
  const lh = 24;
  const lx = x2 + 12; const ly = y2 - lh / 2;
  mapCtx.fillStyle = 'rgba(10,10,20,0.88)';
  fillRoundedRect(mapCtx, lx, ly, lw, lh, 5);
  mapCtx.fillStyle = '#ff9800';
  mapCtx.textAlign = 'left'; mapCtx.textBaseline = 'middle';
  mapCtx.fillText(label, lx + 7, y2);
  mapCtx.restore();
}

const _tokImgCache = {};
function drawToken(tok) {
  const size = tok.size || mapState.grid_size * 0.9;
  const sx = tok.x * mapZoom + mapOffset.x;
  const sy = tok.y * mapZoom + mapOffset.y;
  const sr = size * mapZoom / 2;
  mapCtx.save();
  mapCtx.beginPath();
  mapCtx.arc(sx, sy, sr, 0, Math.PI * 2);
  mapCtx.fillStyle = tok.color || '#7c6af7';
  mapCtx.fill();
  if (tok.id === selectedTokenId) {
    mapCtx.strokeStyle = '#7c6af7'; mapCtx.lineWidth = 3; mapCtx.stroke();
  } else {
    mapCtx.strokeStyle = 'rgba(255,255,255,0.3)'; mapCtx.lineWidth = 1.5; mapCtx.stroke();
  }
  // Photo layer (clipped circle)
  if (tok.image) {
    if (!_tokImgCache[tok.image]) {
      const img = new Image();
      img.onload = () => { _tokImgCache[tok.image] = img; drawMap(); };
      img.src = tok.image;
      _tokImgCache[tok.image] = null; // mark loading
    }
    const cached = _tokImgCache[tok.image];
    if (cached) {
      mapCtx.save();
      mapCtx.beginPath(); mapCtx.arc(sx, sy, sr - 1, 0, Math.PI * 2); mapCtx.clip();
      mapCtx.drawImage(cached, sx - sr, sy - sr, sr * 2, sr * 2);
      mapCtx.restore();
    }
  } else {
    // Emoji fallback
    mapCtx.font = `${sr * 0.9}px serif`;
    mapCtx.textAlign = 'center'; mapCtx.textBaseline = 'middle';
    mapCtx.fillText(tok.emoji || '⚔️', sx, sy);
  }
  // Name label
  mapCtx.font = `bold ${Math.max(10, sr * 0.35)}px sans-serif`;
  mapCtx.fillStyle = '#fff'; mapCtx.strokeStyle = 'rgba(0,0,0,0.8)'; mapCtx.lineWidth = 2;
  mapCtx.textAlign = 'center'; mapCtx.textBaseline = 'top';
  mapCtx.strokeText(tok.name || '', sx, sy + sr + 4);
  mapCtx.fillText(tok.name || '', sx, sy + sr + 4);
  // HP bar
  if (tok.hp_max) {
    const bw = sr * 1.6, bh = 5;
    const bx = sx - bw / 2, by = sy - sr - 8;
    mapCtx.fillStyle = '#333'; mapCtx.fillRect(bx, by, bw, bh);
    const pct = Math.max(0, Math.min(1, (tok.hp || 0) / tok.hp_max));
    mapCtx.fillStyle = pct > 0.5 ? '#4caf50' : pct > 0.25 ? '#ff9800' : '#e94560';
    mapCtx.fillRect(bx, by, bw * pct, bh);
  }
  mapCtx.restore();
}

function fillRoundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
  ctx.fill();
}

function drawPin(pin) {
  const sx = pin.x * mapZoom + mapOffset.x;
  const sy = pin.y * mapZoom + mapOffset.y;
  const r = 14;
  const color = pin.color || '#FF9800';
  mapCtx.save();
  // Círculo da cabeça
  mapCtx.beginPath();
  mapCtx.arc(sx, sy - r - 2, r, 0, Math.PI * 2);
  mapCtx.fillStyle = color;
  mapCtx.fill();
  mapCtx.strokeStyle = 'rgba(255,255,255,0.55)';
  mapCtx.lineWidth = 1.5;
  mapCtx.stroke();
  // Cauda triangular apontando para baixo
  mapCtx.beginPath();
  mapCtx.moveTo(sx - 5, sy - r + 5);
  mapCtx.lineTo(sx + 5, sy - r + 5);
  mapCtx.lineTo(sx, sy + 4);
  mapCtx.closePath();
  mapCtx.fillStyle = color;
  mapCtx.fill();
  // Ponto branco interno
  mapCtx.beginPath();
  mapCtx.arc(sx, sy - r - 2, r * 0.32, 0, Math.PI * 2);
  mapCtx.fillStyle = 'rgba(255,255,255,0.85)';
  mapCtx.fill();
  // Label
  if (pin.label) {
    mapCtx.font = 'bold 11px sans-serif';
    mapCtx.textAlign = 'center';
    mapCtx.textBaseline = 'top';
    const tw = mapCtx.measureText(pin.label).width;
    const pw = tw + 10, ph = 16, px = sx - pw / 2, py = sy + 6;
    mapCtx.fillStyle = 'rgba(0,0,0,0.82)';
    fillRoundedRect(mapCtx, px, py, pw, ph, 3);
    mapCtx.fillStyle = '#fff';
    mapCtx.fillText(pin.label, sx, py + 2);
  }
  mapCtx.restore();
}

function getPinAt(sx, sy) {
  for (const pin of Object.values(pins).reverse()) {
    const psx = pin.x * mapZoom + mapOffset.x;
    const psy = pin.y * mapZoom + mapOffset.y;
    if (Math.hypot(sx - psx, sy - (psy - 16)) <= 18) return pin;
  }
  return null;
}

function screenToMap(sx, sy) {
  return { x: (sx - mapOffset.x) / mapZoom, y: (sy - mapOffset.y) / mapZoom };
}

function snapToGridPos(mx, my) {
  if (!snapToGrid) return { x: mx, y: my };
  const gs = mapState.grid_size;
  return { x: Math.round(mx / gs) * gs, y: Math.round(my / gs) * gs };
}

function getTokenAt(mx, my) {
  for (const tok of Object.values(tokens).reverse()) {
    const r = (tok.size || mapState.grid_size * 0.9) / 2;
    if (Math.hypot(mx - tok.x, my - tok.y) <= r) return tok;
  }
  return null;
}

function onMapMouseDown(e) {
  if (e.button === 1 || (e.button === 0 && e.altKey)) {
    isPanning = true; panStart = { x: e.clientX - mapOffset.x, y: e.clientY - mapOffset.y };
    mapCanvas.style.cursor = 'grabbing'; return;
  }
  const mp = screenToMap(e.clientX - mapCanvas.getBoundingClientRect().left, e.clientY - mapCanvas.getBoundingClientRect().top);
  if (currentTool === 'measure') { measureStart = { ...mp }; measureEnd = { ...mp }; return; }
  if (currentTool === 'move') {
    isPanning = true; panStart = { x: e.clientX - mapOffset.x, y: e.clientY - mapOffset.y };
    mapCanvas.style.cursor = 'grabbing'; return;
  }
  if (currentTool === 'pin' && isGM && e.button === 0) {
    pendingPinPos = { ...mp };
    showPinPopup(e.clientX, e.clientY);
    return;
  }
  const tok = getTokenAt(mp.x, mp.y);
  if (tok) {
    draggingToken = tok; dragOffX = mp.x - tok.x; dragOffY = mp.y - tok.y;
    selectedTokenId = tok.id; drawMap(); return;
  }
  selectedTokenId = null; drawMap();
}

function onMapMouseMove(e) {
  const rect = mapCanvas.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  if (isPanning) {
    mapOffset.x = e.clientX - panStart.x; mapOffset.y = e.clientY - panStart.y;
    drawMap(); return;
  }
  if (draggingToken) {
    const mp = screenToMap(mx, my);
    const snapped = snapToGridPos(mp.x - dragOffX, mp.y - dragOffY);
    draggingToken.x = snapped.x; draggingToken.y = snapped.y;
    drawMap(); return;
  }
  if (currentTool === 'measure' && measureStart) {
    measureEnd = screenToMap(mx, my); drawMap();
  }
  const zl = document.getElementById('zoom-info');
  if (zl) zl.textContent = Math.round(mapZoom * 100) + '%';
}

function onMapMouseUp(e) {
  if (draggingToken) {
    socket.emit('token_move', { room_id: ROOM_ID, token_id: draggingToken.id, x: draggingToken.x, y: draggingToken.y });
    draggingToken = null;
  }
  if (isPanning) { mapCanvas.style.cursor = currentTool === 'move' ? 'grab' : 'crosshair'; }
  isPanning = false;
}

function onMapWheel(e) {
  e.preventDefault();
  const rect = mapCanvas.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;

  // Scroll sobre token = redimensionar (só GM)
  if (isGM) {
    const mp = screenToMap(mx, my);
    const tok = getTokenAt(mp.x, mp.y);
    if (tok) {
      const gs = mapState.grid_size;
      const step = gs * 0.25;
      const cur = tok.size || gs * 0.9;
      tok.size = Math.max(gs * 0.2, e.deltaY > 0 ? cur - step : cur + step);
      tokens[tok.id] = tok;
      socket.emit('token_update', { room_id: ROOM_ID, token: { ...tok } });
      drawMap();
      return;
    }
  }

  const delta = e.deltaY > 0 ? 0.9 : 1.1;
  const newZoom = Math.min(4, Math.max(0.1, mapZoom * delta));
  mapOffset.x = mx - (mx - mapOffset.x) * (newZoom / mapZoom);
  mapOffset.y = my - (my - mapOffset.y) * (newZoom / mapZoom);
  mapZoom = newZoom;
  drawMap();
  const zl = document.getElementById('zoom-info');
  if (zl) zl.textContent = Math.round(mapZoom * 100) + '%';
}

function onMapContextMenu(e) {
  e.preventDefault();
  const rect = mapCanvas.getBoundingClientRect();
  const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
  const mp = screenToMap(sx, sy);
  if (isGM) {
    const pin = getPinAt(sx, sy);
    if (pin) {
      contextMenuPin = pin;
      const pmenu = document.getElementById('pin-menu');
      pmenu.classList.remove('hidden');
      pmenu.style.left = e.clientX + 'px'; pmenu.style.top = e.clientY + 'px';
      return;
    }
  }
  const tok = getTokenAt(mp.x, mp.y);
  if (!isGM || !tok) return;
  contextMenuToken = tok;
  const menu = document.getElementById('token-menu');
  menu.classList.remove('hidden');
  menu.style.left = e.clientX + 'px'; menu.style.top = e.clientY + 'px';
}

function hideContextMenu() {
  const menu = document.getElementById('token-menu');
  if (menu) menu.classList.add('hidden');
  const pmenu = document.getElementById('pin-menu');
  if (pmenu) pmenu.classList.add('hidden');
}

function openTokenResizePanel() {
  if (!contextMenuToken) return;
  hideContextMenu();
  const tok = contextMenuToken;
  const gs = mapState.grid_size;
  const cur = tok.size ? Math.round(tok.size / gs * 10) / 10 : 0.9;

  let panel = document.getElementById('token-resize-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'token-resize-panel';
    panel.className = 'token-resize-panel';
    document.body.appendChild(panel);
  }

  panel.innerHTML = `
    <div class="trp-title">📐 Tamanho do Token</div>
    <div class="trp-btns">
      <button class="trp-btn${Math.abs(cur - 0.5) < 0.05 ? ' active' : ''}" onclick="applyTokenResize(0.5)">½×</button>
      <button class="trp-btn${Math.abs(cur - 0.9) < 0.05 ? ' active' : ''}" onclick="applyTokenResize(0.9)">1×</button>
      <button class="trp-btn${Math.abs(cur - 1.8) < 0.05 ? ' active' : ''}" onclick="applyTokenResize(1.8)">2×</button>
      <button class="trp-btn${Math.abs(cur - 2.7) < 0.05 ? ' active' : ''}" onclick="applyTokenResize(2.7)">3×</button>
      <button class="trp-btn${Math.abs(cur - 3.6) < 0.05 ? ' active' : ''}" onclick="applyTokenResize(3.6)">4×</button>
    </div>
    <div class="trp-custom">
      <input id="trp-custom-val" type="number" min="0.1" max="10" step="0.1" value="${cur}" style="width:60px">
      <span style="color:var(--text-muted);font-size:12px">× casas</span>
      <button class="trp-btn" onclick="applyTokenResize(parseFloat(document.getElementById('trp-custom-val').value)||1)">OK</button>
    </div>
    <button class="trp-close" onclick="closeTokenResizePanel()">✕</button>`;

  panel.classList.remove('hidden');
  contextMenuToken = tok;
}

function applyTokenResize(mult) {
  if (!contextMenuToken) return;
  const gs = mapState.grid_size;
  contextMenuToken.size = Math.max(gs * 0.1, mult * gs);
  tokens[contextMenuToken.id] = contextMenuToken;
  socket.emit('token_update', { room_id: ROOM_ID, token: { ...contextMenuToken } });
  drawMap();
  closeTokenResizePanel();
}

function closeTokenResizePanel() {
  const p = document.getElementById('token-resize-panel');
  if (p) p.classList.add('hidden');
  contextMenuToken = null;
}

function tokenMenuAction(action) {
  if (!contextMenuToken) return;
  if (action === 'remove') {
    delete tokens[contextMenuToken.id];
    socket.emit('token_remove', { room_id: ROOM_ID, token_id: contextMenuToken.id });
    drawMap();
  } else if (action === 'edit') {
    const name = prompt('Novo nome:', contextMenuToken.name);
    if (name !== null) {
      contextMenuToken.name = name;
      socket.emit('token_update', { room_id: ROOM_ID, token: { ...contextMenuToken } });
      drawMap();
    }
  } else if (action === 'hp') {
    const hp = prompt('HP atual:', contextMenuToken.hp || 0);
    const hpMax = prompt('HP máximo:', contextMenuToken.hp_max || 0);
    if (hp !== null) {
      contextMenuToken.hp = parseInt(hp) || 0;
      contextMenuToken.hp_max = parseInt(hpMax) || 0;
      socket.emit('token_update', { room_id: ROOM_ID, token: { ...contextMenuToken } });
      drawMap();
    }
  } else if (action === 'resize') {
    openTokenResizePanel();
    return;
  } else if (action === 'avatar') {
    // Build a small picker from current players with avatars
    const opts = Object.entries(players)
      .filter(([, p]) => p.vitals?.avatar)
      .map(([sid, p]) => `${p.name} (${p.vitals.char_name || 'sem personagem'}):::${p.vitals.avatar}`)
      .join('\n');
    if (!opts) { alert('Nenhum jogador tem avatar na ficha no momento.'); }
    else {
      const lines = opts.split('\n');
      const names = lines.map((l, i) => `${i + 1}. ${l.split(':::')[0]}`).join('\n');
      const choice = prompt(`Escolha o avatar:\n${names}\n\nDigite o número:`, '1');
      if (choice !== null) {
        const idx = parseInt(choice) - 1;
        if (idx >= 0 && idx < lines.length) {
          contextMenuToken.image = lines[idx].split(':::')[1];
          socket.emit('token_update', { room_id: ROOM_ID, token: { ...contextMenuToken } });
          drawMap();
        }
      }
    }
  }
  hideContextMenu();
  contextMenuToken = null;
}

// ===================== PINS =====================
function showPinPopup(cx, cy) {
  const popup = document.getElementById('pin-popup');
  popup.classList.remove('hidden');
  const pw = 244;
  popup.style.left = Math.min(cx, window.innerWidth - pw - 8) + 'px';
  popup.style.top = Math.min(cy, window.innerHeight - 160) + 'px';
  document.getElementById('pin-label-input').value = '';
  document.getElementById('pin-label-input').focus();
}

function closePinPopup() {
  document.getElementById('pin-popup').classList.add('hidden');
  pendingPinPos = null;
}

function selectPinColor(el) {
  document.querySelectorAll('.pin-color-opt').forEach(e => e.classList.remove('selected'));
  el.classList.add('selected');
  selectedPinColor = el.dataset.color;
}

function confirmAddPin() {
  if (!pendingPinPos) return;
  const label = document.getElementById('pin-label-input').value.trim();
  const id = 'pin-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  const pin = { id, label, color: selectedPinColor, x: pendingPinPos.x, y: pendingPinPos.y };
  pins[id] = pin;
  socket.emit('pin_add', { room_id: ROOM_ID, pin });
  closePinPopup();
  drawMap();
}

function pinMenuAction(action) {
  if (!contextMenuPin) return;
  if (action === 'remove') {
    delete pins[contextMenuPin.id];
    socket.emit('pin_remove', { room_id: ROOM_ID, pin_id: contextMenuPin.id });
    drawMap();
  } else if (action === 'edit') {
    const label = prompt('Nome do ponto:', contextMenuPin.label);
    if (label !== null) {
      contextMenuPin.label = label;
      socket.emit('pin_update', { room_id: ROOM_ID, pin: { ...contextMenuPin } });
      drawMap();
    }
  }
  hideContextMenu();
  contextMenuPin = null;
}

socket.on('pin_added', (pin) => { pins[pin.id] = pin; drawMap(); });
socket.on('pin_removed', (d) => { delete pins[d.pin_id]; if (mapInited) drawMap(); });
socket.on('pin_updated', (pin) => { if (pins[pin.id]) pins[pin.id] = { ...pins[pin.id], ...pin }; if (mapInited) drawMap(); });

socket.on('token_added', (tok) => { tokens[tok.id] = tok; drawMap(); });
socket.on('token_moved', (d) => { if (tokens[d.token_id]) { tokens[d.token_id].x = d.x; tokens[d.token_id].y = d.y; drawMap(); } });
socket.on('token_removed', (d) => { delete tokens[d.token_id]; drawMap(); });
socket.on('token_updated', (tok) => { tokens[tok.id] = { ...tokens[tok.id], ...tok }; drawMap(); });
socket.on('map_updated', applyMapState);

function applyMapState(data) {
  Object.assign(mapState, data);
  if (data.background) {
    const img = new Image();
    img.onload = () => { mapBgImage = img; drawMap(); };
    img.src = data.background;
  } else if (data.background === null) {
    mapBgImage = null; drawMap();
  }
}

function spawnToken(tok) { tokens[tok.id] = tok; if (mapInited) drawMap(); }

function setTool(t) {
  currentTool = t;
  document.querySelectorAll('.tool-btn[id^="tool-"]').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('tool-' + t);
  if (btn) btn.classList.add('active');
  mapCanvas.style.cursor = t === 'move' ? 'grab' : 'crosshair';
  if (t !== 'measure') {
    measureStart = null; measureEnd = null;
    const badge = document.getElementById('measure-display');
    if (badge) badge.style.display = 'none';
  }
}

function toggleGridPanel() {
  document.getElementById('grid-panel').classList.toggle('hidden');
}
function updateGridSize(v) {
  document.getElementById('grid-size-val').textContent = v + 'px';
  mapState.grid_size = parseInt(v);
  socket.emit('map_update', { room_id: ROOM_ID, map: { grid_size: mapState.grid_size } });
  drawMap();
}
function updateGridColor(v) {
  mapState.grid_color = v;
  socket.emit('map_update', { room_id: ROOM_ID, map: { grid_color: v } });
  drawMap();
}
function updateGridOpacity(v) {
  document.getElementById('grid-opacity-val').textContent = v + '%';
  mapState.grid_opacity = parseInt(v) / 100;
  socket.emit('map_update', { room_id: ROOM_ID, map: { grid_opacity: mapState.grid_opacity } });
  drawMap();
}
function setGridType(type, btn) {
  mapState.grid_type = type;
  document.querySelectorAll('#grid-type-square,#grid-type-hex').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  socket.emit('map_update', { room_id: ROOM_ID, map: { grid_type: type } });
  drawMap();
}
function toggleSnap(v) { snapToGrid = v; }
function setGridVisible(v) {
  mapState.show_grid = v;
  socket.emit('map_update', { room_id: ROOM_ID, map: { show_grid: v } });
  drawMap();
}
function clearMapBg() {
  mapBgImage = null; mapState.background = null;
  socket.emit('map_update', { room_id: ROOM_ID, map: { background: null } });
  drawMap();
}
function uploadMapBg(event) {
  const file = event.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      mapBgImage = img;
      mapState.background = e.target.result;
      mapState.width = img.width; mapState.height = img.height;
      socket.emit('map_update', { room_id: ROOM_ID, map: { background: e.target.result, width: img.width, height: img.height } });
      drawMap();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
  event.target.value = '';
}

// ===================== TOKENS MODAL =====================
let selectedTokenColor = '#e94560', selectedTokenEmoji = '⚔️';
let selectedTokenSizeMult = 0.9; // grid size multiplier
let pendingTokenImage = null;

function openAddToken() {
  if (!isGM) return;
  document.getElementById('token-name').value = '';
  document.getElementById('token-hp').value = '';
  document.getElementById('token-hp-max').value = '';
  pendingTokenImage = null;
  selectedTokenSizeMult = 0.9;
  document.querySelectorAll('.tok-sz-btn').forEach(b => b.classList.toggle('active', b.dataset.sz === '0.9'));
  // Populate player dropdown
  const sel = document.getElementById('token-player-select');
  if (sel) {
    sel.innerHTML = '<option value="">— Nenhum / Monstro —</option>';
    for (const [sid, p] of Object.entries(players)) {
      const opt = document.createElement('option');
      opt.value = sid;
      opt.textContent = p.name + (p.vitals?.char_name ? ` (${p.vitals.char_name})` : '');
      sel.appendChild(opt);
    }
    sel.value = '';
  }
  document.getElementById('modal-token').classList.remove('hidden');
}

function tokenPickPlayer(sid) {
  if (!sid) { pendingTokenImage = null; return; }
  const p = players[sid];
  if (!p) return;
  const nameEl = document.getElementById('token-name');
  if (nameEl && !nameEl.value) nameEl.value = p.vitals?.char_name || p.name;
  if (p.vitals?.avatar) pendingTokenImage = p.vitals.avatar;
}

function pickTokenSize(el) {
  document.querySelectorAll('.tok-sz-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  selectedTokenSizeMult = parseFloat(el.dataset.sz) || 0.9;
}
function pickColor(el) {
  document.querySelectorAll('.color-opt').forEach(e => e.classList.remove('selected'));
  el.classList.add('selected'); selectedTokenColor = el.dataset.color;
}
function pickEmoji(el) {
  document.querySelectorAll('.emoji-opt').forEach(e => e.classList.remove('selected'));
  el.classList.add('selected'); selectedTokenEmoji = el.dataset.emoji;
}
function addToken() {
  const name = (document.getElementById('token-name').value || 'Token').trim();
  const hp = parseInt(document.getElementById('token-hp').value) || 0;
  const hpMax = parseInt(document.getElementById('token-hp-max').value) || 0;
  const id = 'tok-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  const gs = mapState.grid_size;
  const tok = {
    id, name, color: selectedTokenColor, emoji: selectedTokenEmoji,
    hp, hp_max: hpMax, x: gs * 2, y: gs * 2,
    size: gs * selectedTokenSizeMult,
    image: pendingTokenImage || null
  };
  tokens[id] = tok;
  socket.emit('token_add', { room_id: ROOM_ID, token: tok });
  if (mapInited) drawMap();
  closeModal('modal-token');
  switchView('map');
}

// ===================== GM SHEET VIEWER =====================
function requestPlayerSheet(sid) {
  socket.emit('request_player_sheet', { room_id: ROOM_ID, target_sid: sid });
}

socket.on('player_sheet_data', (data) => {
  const modal = document.getElementById('modal-gm-sheet');
  const title = document.getElementById('gm-sheet-title');
  const content = document.getElementById('gm-sheet-content');
  const p = players[data.sid];
  title.textContent = '📋 Ficha de ' + (p?.name || 'Jogador');
  const s = data.sheet || {};
  content.innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      ${sheetRow('Nome', s.name)}
      ${sheetRow('Idade', s.age)} ${sheetRow('Altura', s.height)} ${sheetRow('Peso', s.weight)}
      ${sheetRow('Aparência', s.appearance)}
      <tr><td colspan="2" style="padding-top:12px;font-weight:700;color:var(--text-faint);font-size:10px;letter-spacing:1px">ATRIBUTOS</td></tr>
      ${sheetRow('Força', s.forca)} ${sheetRow('Agilidade', s.agilidade)} ${sheetRow('Inteligência', s.inteligencia)}
      ${sheetRow('Mental', s.mental)} ${sheetRow('Lábia', s.labia)} ${sheetRow('Furtividade', s.furtividade)} ${sheetRow('Defesa', s.defesa)}
      <tr><td colspan="2" style="padding-top:12px;font-weight:700;color:var(--text-faint);font-size:10px;letter-spacing:1px">VITAIS</td></tr>
      ${sheetRow('Vida', (s.vida||'?') + '/' + (s['vida-max']||'?'))}
      ${sheetRow('Sanidade', (s.sanidade||'?') + '/' + (s['sanidade-max']||'?'))}
      ${sheetRow('Energia', (s.energia||'?') + '/' + (s['energia-max']||'?'))}
    </table>`;
  modal.classList.remove('hidden');
});

function sheetRow(label, value) {
  if (!value && value !== 0) return '';
  return `<tr><td style="padding:3px 6px;color:var(--text-muted);width:40%">${label}</td><td style="padding:3px 6px;color:var(--text-primary)">${value}</td></tr>`;
}

function editPlayerVitals(sid) {
  const p = players[sid];
  if (!p) return;
  const v = p.vitals || {};
  const vida = prompt('Vida atual:', v.vida || 0);
  if (vida === null) return;
  const vidaMax = prompt('Vida máx:', v.vida_max || 60);
  const san = prompt('Mental atual:', v.sanidade || 0);
  const sanMax = prompt('Mental máx:', v.sanidade_max || 50);
  const en = prompt('Energia atual:', v.energia || 0);
  const enMax = prompt('Energia máx:', v.energia_max || 50);
  const newVitals = {
    ...v, vida: parseInt(vida)||0, vida_max: parseInt(vidaMax)||0,
    sanidade: parseInt(san)||0, sanidade_max: parseInt(sanMax)||0,
    energia: parseInt(en)||0, energia_max: parseInt(enMax)||0
  };
  socket.emit('update_vitals', { room_id: ROOM_ID, target_sid: sid, vitals: newVitals });
}

socket.on('player_vitals_updated', (data) => {
  if (players[data.sid]) players[data.sid].vitals = data.vitals;
  renderPlayers();
});

// ===================== FICHA =====================
const SHEET_KEY = 'rpg_sheet_v2';
let avatarScale = 1, avatarX = 0, avatarY = 0, avatarDragging = false, avatarDragStart = { x: 0, y: 0 };

function switchSheetTab(name, btn) {
  document.querySelectorAll('.stab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.sheet-tab').forEach(b => b.classList.remove('active'));
  document.getElementById('stab-' + name)?.classList.add('active');
  if (btn) btn.classList.add('active');
}

function openSheet() {
  loadSheetFromStorage();
  switchSheetTab('perfil', document.querySelector('.sheet-tab[data-tab="perfil"]'));
  document.getElementById('modal-sheet').classList.remove('hidden');
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}

function openQR() {
  const url = window._radminURL || window.location.origin;
  document.getElementById('qr-url-text').textContent = url;

  const qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();

  const canvas = document.getElementById('qr-canvas');
  const size = 200;
  const count = qr.getModuleCount();
  const cell = Math.floor(size / count);
  canvas.width = canvas.height = cell * count;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#15151e';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#e8e8f0';
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) ctx.fillRect(c * cell, r * cell, cell, cell);
    }
  }

  document.getElementById('modal-qr').classList.remove('hidden');
}

function saveSheet() {
  const sheet = gatherSheet();
  localStorage.setItem(SHEET_KEY, JSON.stringify(sheet));
  socket.emit('share_sheet', { room_id: ROOM_ID, sheet });
  closeModal('modal-sheet');
}

function gatherSheet() {
  const g = (id) => (document.getElementById(id)||{}).value || '';
  const s = {
    name: g('sh-name'), age: g('sh-age'), height: g('sh-height'), weight: g('sh-weight'),
    appearance: g('sh-appearance'), origin: g('sh-origin'), profissao: g('sh-profissao'),
    forca: g('sh-forca'), agilidade: g('sh-agilidade'), inteligencia: g('sh-inteligencia'),
    mental: g('sh-mental'), labia: g('sh-labia'), furtividade: g('sh-furtividade'), defesa: g('sh-defesa'),
    investigacao: g('sh-investigacao'), sobrevivencia: g('sh-sobrevivencia'),
    ocultismo: g('sh-ocultismo'), religiao: g('sh-religiao'),
    medicina: g('sh-medicina'), intuicao: g('sh-intuicao'),
    vida: g('sh-vida'), 'vida-max': g('sh-vida-max'),
    sanidade: g('sh-sanidade'), 'sanidade-max': g('sh-sanidade-max'),
    energia: g('sh-energia'), 'energia-max': g('sh-energia-max'),
    xp: g('sh-xp'), nivel: g('sh-nivel'),
    equipamentos: g('sh-equipamentos'), personalidade: g('sh-personalidade'),
    'nao-pode': g('sh-nao-pode'), 'mais-ama': g('sh-mais-ama'),
    'mais-odeia': g('sh-mais-odeia'), 'mais-teme': g('sh-mais-teme'),
    historia: g('sh-historia'), anotacoes: g('sh-anotacoes'),
    'attr-max': g('sh-attr-max') || '16', 'per-max': g('sh-per-max') || '7',
  };
  s.classes = {
    sentitivo: document.getElementById('sh-cls-sentitivo')?.checked || false,
    possuido: document.getElementById('sh-cls-possuido')?.checked || false,
    feiticeiro: document.getElementById('sh-cls-feiticeiro')?.checked || false,
    santificado: document.getElementById('sh-cls-santificado')?.checked || false,
  };
  s.inventory = [];
  document.querySelectorAll('.inv-item input').forEach(i => s.inventory.push(i.value));
  s.habilidades = [];
  document.querySelectorAll('.hab-item').forEach(hab => {
    s.habilidades.push({
      name: hab.querySelector('.hab-name')?.value || '',
      cost: hab.querySelector('.hab-cost')?.value || '',
      passiva: hab.querySelector('.hab-passiva')?.value || '',
      central: hab.querySelector('.hab-central')?.value || '',
      desc: hab.querySelector('.hab-desc')?.value || '',
    });
  });
  s.avatar = document.getElementById('sh-avatar')?.src || null;
  s.avatarTransform = { scale: avatarScale, x: avatarX, y: avatarY };
  return s;
}

function loadSheetFromStorage() {
  const raw = localStorage.getItem(SHEET_KEY);
  if (!raw) return;
  try { applySheet(JSON.parse(raw)); } catch(e) {}
}

function applySheet(s) {
  const set = (id, val) => { const el = document.getElementById(id); if (el && val !== undefined) el.value = val; };
  set('sh-name', s.name); set('sh-age', s.age); set('sh-height', s.height); set('sh-weight', s.weight);
  set('sh-appearance', s.appearance); set('sh-origin', s.origin); set('sh-profissao', s.profissao);
  set('sh-forca', s.forca); set('sh-agilidade', s.agilidade); set('sh-inteligencia', s.inteligencia);
  set('sh-mental', s.mental); set('sh-labia', s.labia); set('sh-furtividade', s.furtividade); set('sh-defesa', s.defesa);
  set('sh-investigacao', s.investigacao); set('sh-sobrevivencia', s.sobrevivencia);
  set('sh-ocultismo', s.ocultismo); set('sh-religiao', s.religiao);
  set('sh-medicina', s.medicina); set('sh-intuicao', s.intuicao);
  set('sh-vida', s.vida); set('sh-vida-max', s['vida-max']);
  set('sh-sanidade', s.sanidade); set('sh-sanidade-max', s['sanidade-max']);
  set('sh-energia', s.energia); set('sh-energia-max', s['energia-max']);
  set('sh-xp', s.xp); set('sh-nivel', s.nivel);
  set('sh-equipamentos', s.equipamentos); set('sh-personalidade', s.personalidade);
  set('sh-nao-pode', s['nao-pode']); set('sh-mais-ama', s['mais-ama']);
  set('sh-mais-odeia', s['mais-odeia']); set('sh-mais-teme', s['mais-teme']);
  set('sh-historia', s.historia); set('sh-anotacoes', s.anotacoes);
  set('sh-attr-max', s['attr-max']); set('sh-per-max', s['per-max']);
  if (s.classes) {
    const cls = { sentitivo: 'sh-cls-sentitivo', possuido: 'sh-cls-possuido', feiticeiro: 'sh-cls-feiticeiro', santificado: 'sh-cls-santificado' };
    for (const [k, id] of Object.entries(cls)) { const el = document.getElementById(id); if (el) el.checked = !!s.classes[k]; }
  }
  const invList = document.getElementById('sh-inventory-list');
  if (invList) { invList.innerHTML = ''; (s.inventory || []).forEach(item => addInventoryItem(item)); }
  const habList = document.getElementById('sh-habilidades-list');
  if (habList) { habList.innerHTML = ''; (s.habilidades || []).forEach(h => addHabilidade(h)); }
  if (s.avatar) {
    const img = document.getElementById('sh-avatar');
    const ph = document.getElementById('sh-avatar-placeholder');
    const ctrl = document.getElementById('sh-avatar-controls');
    if (img) { img.src = s.avatar; img.style.display = 'block'; }
    if (ph) ph.style.display = 'none';
    if (ctrl) ctrl.style.display = 'flex';
    if (s.avatarTransform) {
      avatarScale = s.avatarTransform.scale || 1;
      avatarX = s.avatarTransform.x || 0;
      avatarY = s.avatarTransform.y || 0;
      applyAvatarTransform();
    }
  }
  updateAttrPoints(); updatePerPoints();
}

function updateAttrPoints() {
  const attrs = ['forca','agilidade','inteligencia','mental','labia','furtividade','defesa'];
  let used = 0;
  for (const a of attrs) { const el = document.getElementById('sh-' + a); if (el) used += parseInt(el.value) || 0; }
  const usedEl = document.getElementById('sh-attr-used');
  if (usedEl) usedEl.textContent = used;
  updateAttrHint();
}
function updateAttrHint() {
  const max = parseInt(document.getElementById('sh-attr-max')?.value) || 16;
  const used = parseInt(document.getElementById('sh-attr-used')?.textContent) || 0;
  const hint = document.getElementById('sh-attr-hint-text');
  if (hint) hint.textContent = (max - used) + ' pontos para distribuir';
}
function updatePerPoints() {
  const pers = ['investigacao','sobrevivencia','ocultismo','religiao','medicina','intuicao'];
  let used = 0;
  for (const p of pers) { const el = document.getElementById('sh-' + p); if (el) used += parseInt(el.value) || 0; }
  const usedEl = document.getElementById('sh-per-used');
  if (usedEl) usedEl.textContent = used;
  updatePerHint();
}
function updatePerHint() {
  const max = parseInt(document.getElementById('sh-per-max')?.value) || 7;
  const used = parseInt(document.getElementById('sh-per-used')?.textContent) || 0;
  const hint = document.getElementById('sh-per-hint-text');
  if (hint) hint.textContent = (max - used) + ' pontos para distribuir';
}

function addInventoryItem(value = '') {
  const list = document.getElementById('sh-inventory-list');
  if (!list) return;
  const item = document.createElement('div'); item.className = 'inv-item';
  item.innerHTML = `<input type="text" placeholder="Item..." value="${value}"><button class="inv-del" onclick="this.parentElement.remove()">×</button>`;
  list.appendChild(item);
}

function escHtml(s) {
  return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function addHabilidade(data = {}) {
  const list = document.getElementById('sh-habilidades-list');
  if (!list) return;
  const item = document.createElement('div'); item.className = 'hab-item';
  const passiva = data.passiva || data.desc || '';
  item.innerHTML = `
    <div class="hab-header">
      <input type="text" class="hab-name" placeholder="Nome da habilidade" value="${escHtml(data.name||'')}">
      <button class="hab-del" onclick="this.closest('.hab-item').remove()">×</button>
    </div>
    <div class="hab-sub-label">PASSIVA</div>
    <textarea class="hab-passiva" placeholder="Efeito passivo desta habilidade...">${escHtml(passiva)}</textarea>
    <div class="hab-sub-label">CENTRAL</div>
    <textarea class="hab-central" placeholder="Efeito principal / ação desta habilidade...">${escHtml(data.central||'')}</textarea>
    <div class="hab-gasto-row">
      <span class="hab-sub-label" style="margin:0;min-width:44px">GASTO</span>
      <input type="text" class="hab-cost" placeholder="Ex: 10 Energia, 1 ação..." value="${escHtml(data.cost||'')}">
    </div>`;
  list.appendChild(item);
}

function loadSheetAvatar(event) {
  const file = event.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = document.getElementById('sh-avatar');
    const ph = document.getElementById('sh-avatar-placeholder');
    const ctrl = document.getElementById('sh-avatar-controls');
    img.src = e.target.result; img.style.display = 'block';
    if (ph) ph.style.display = 'none';
    if (ctrl) ctrl.style.display = 'flex';
    avatarScale = 1; avatarX = 0; avatarY = 0;
    applyAvatarTransform();
  };
  reader.readAsDataURL(file);
}

document.getElementById('sh-avatar-slot').addEventListener('click', (e) => {
  if (e.target.closest('.sheet-avatar-controls')) return;
  document.getElementById('sh-img-upload').click();
});

let _avatarMouseDown = false, _avatarStart = {};
document.getElementById('sh-avatar-viewport').addEventListener('mousedown', (e) => {
  if (document.getElementById('sh-avatar').style.display === 'none') return;
  _avatarMouseDown = true; _avatarStart = { x: e.clientX - avatarX, y: e.clientY - avatarY };
  e.preventDefault();
});
document.addEventListener('mousemove', (e) => {
  if (!_avatarMouseDown) return;
  avatarX = e.clientX - _avatarStart.x; avatarY = e.clientY - _avatarStart.y;
  applyAvatarTransform();
});
document.addEventListener('mouseup', () => { _avatarMouseDown = false; });

function avatarZoom(delta) {
  avatarScale = Math.max(0.1, Math.min(5, avatarScale + delta));
  applyAvatarTransform();
}
function resetAvatar() { avatarScale = 1; avatarX = 0; avatarY = 0; applyAvatarTransform(); }
function applyAvatarTransform() {
  const img = document.getElementById('sh-avatar');
  if (img) img.style.transform = `translate(${avatarX}px, ${avatarY}px) scale(${avatarScale})`;
}

// ===================== DADO D6 FRACIONADO =====================
function rollFracD6() {
  const face = Math.floor(Math.random() * 6) + 1;
  const decimal = (Math.floor(Math.random() * 9) + 1) / 10;
  const result = face + decimal;
  socket.emit('roll_dice', { room_id: ROOM_ID, dice: 6, count: 1, modifier: 0, _frac: result });
  // Override with fractional roll message
  const myName = playerName;
  const msg = {
    type: 'roll', author: myName,
    text: `rolou d6✦ (iniciativa): **${result}**`,
    rolls: [result], total: result, id: 'frac-' + Date.now()
  };
  appendMessage(msg);
}

// ===================== FILA DE TURNO =====================
const COMBAT_KEY = 'rpg_combat_v1';
let combatQueue = [];
let combatTurnIdx = 0;
function toggleTurnQueue() {
  const tq = document.getElementById('turn-queue');
  if (!tq) return;
  const opening = tq.classList.contains('hidden');
  tq.classList.toggle('hidden', !opening);
  if (opening) { initTQResize(); initTQDrag(); }
}

function tqOpenDrop(type) {
  const dd = document.getElementById('tq-add-drop');
  if (!dd) return;
  if (!dd.classList.contains('hidden') && dd.dataset.type === type) {
    dd.classList.add('hidden'); return;
  }
  dd.dataset.type = type;
  dd.innerHTML = '';
  dd.classList.remove('hidden');
  const items = type === 'player'
    ? Object.entries(players).map(([sid, p]) => ({ label: p.name, key: sid }))
    : Object.values(monsters).map(m => ({ label: m.name || 'Monstro', key: m.id }));
  if (!items.length) {
    dd.innerHTML = '<div class="tq-drop-item" style="color:var(--text-faint);padding:8px">Nenhum disponível</div>';
    return;
  }
  items.forEach(item => {
    const div = document.createElement('div');
    div.className = 'tq-drop-item';
    div.textContent = (type === 'player' ? '👤 ' : '☠️ ') + item.label;
    div.onclick = () => { tqAdd(item.label, type, item.key); dd.classList.add('hidden'); };
    dd.appendChild(div);
  });
  document.addEventListener('click', () => dd.classList.add('hidden'), { once: true, capture: true });
}

function tqAdd(name, type, key) {
  const id = 'tqe' + Date.now() + Math.random().toString(36).slice(2, 5);
  combatQueue.push({ id, name, initiative: 0, type, key });
  renderCombatQueue();
  saveCombatQueue();
}

function tqRemove(id) {
  combatQueue = combatQueue.filter(e => e.id !== id);
  if (combatTurnIdx >= combatQueue.length) combatTurnIdx = 0;
  renderCombatQueue();
  saveCombatQueue();
}

function tqClearAll() {
  if (!combatQueue.length) return;
  if (!confirm('Limpar toda a fila de turno?')) return;
  combatQueue = []; combatTurnIdx = 0;
  renderCombatQueue();
  saveCombatQueue();
}

function tqSetInit(id, val) {
  const e = combatQueue.find(x => x.id === id);
  if (!e) return;
  e.initiative = Math.round(parseFloat(val) * 10) / 10 || 0;
  combatQueue.sort((a, b) => b.initiative - a.initiative);
  combatTurnIdx = Math.max(0, combatQueue.findIndex(x => x.id === id));
  renderCombatQueue();
  saveCombatQueue();
}

function tqRollInit(id) {
  const face = Math.floor(Math.random() * 6) + 1;
  const dec = (Math.floor(Math.random() * 9) + 1) / 10;
  tqSetInit(id, face + dec);
}

function nextCombatTurn() {
  if (!combatQueue.length) return;
  combatTurnIdx = (combatTurnIdx + 1) % combatQueue.length;
  renderCombatQueue();
  saveCombatQueue();
}

function renderCombatQueue() {
  const container = document.getElementById('tq-combatants');
  if (!container) return;
  container.innerHTML = '';
  if (!combatQueue.length) {
    container.innerHTML = '<div class="tq-empty">Adicione jogadores ou monstros com +J / +M</div>';
    return;
  }
  combatQueue.forEach((entry, idx) => {
    const isActive = idx === combatTurnIdx;
    const div = document.createElement('div');
    div.className = 'tq-entry' + (isActive ? ' tq-active' : '');
    div.innerHTML = `
      <span class="tq-arrow">${isActive ? '▶' : ''}</span>
      <span class="tq-type-dot ${entry.type}"></span>
      <input type="number" class="tq-init" value="${entry.initiative}" step="0.1"
        title="Iniciativa — edite ou clique 🎲" onchange="tqSetInit('${entry.id}',this.value)">
      <button class="tq-roll-btn" onclick="tqRollInit('${entry.id}')" title="Rolar d6✦">🎲</button>
      <span class="tq-name" title="${escHtml(entry.name)}">${escHtml(entry.name)}</span>
      <button class="tq-rm-btn" onclick="tqRemove('${entry.id}')">×</button>`;
    container.appendChild(div);
  });
}

function saveCombatQueue() {
  try { localStorage.setItem(COMBAT_KEY, JSON.stringify({ q: combatQueue, i: combatTurnIdx })); } catch(e) {}
}

function loadCombatQueue() {
  try {
    const raw = localStorage.getItem(COMBAT_KEY);
    if (raw) { const d = JSON.parse(raw); combatQueue = d.q || []; combatTurnIdx = d.i || 0; }
  } catch(e) {}
  renderCombatQueue();
}

// Resize (top-left corner) and Drag (header) for the floating queue panel
let _tqRes = null, _tqDrag = null;

function initTQResize() {
  const handle = document.getElementById('tq-resize-nw');
  if (!handle || handle._tqBound) return;
  handle._tqBound = true;
  handle.addEventListener('mousedown', e => {
    const panel = document.getElementById('turn-queue');
    const rect = panel.getBoundingClientRect();
    _tqRes = { sx: e.clientX, sy: e.clientY, w: rect.width, h: rect.height };
    e.preventDefault(); e.stopPropagation();
  });
}

function initTQDrag() {
  const header = document.getElementById('tq-header');
  if (!header || header._tqDragBound) return;
  header._tqDragBound = true;
  header.addEventListener('mousedown', e => {
    if (e.target.tagName === 'BUTTON') return; // don't drag when clicking buttons
    const panel = document.getElementById('turn-queue');
    const rect = panel.getBoundingClientRect();
    _tqDrag = { sx: e.clientX, sy: e.clientY, t: panel.offsetTop, l: panel.offsetLeft };
    e.preventDefault();
  });
}

document.addEventListener('mousemove', e => {
  if (_tqRes) {
    const panel = document.getElementById('turn-queue');
    if (!panel) return;
    panel.style.width  = Math.max(200, _tqRes.w + (_tqRes.sx - e.clientX)) + 'px';
    panel.style.height = Math.max(100, _tqRes.h + (_tqRes.sy - e.clientY)) + 'px';
  }
  if (_tqDrag) {
    const panel = document.getElementById('turn-queue');
    if (!panel) return;
    panel.style.left = Math.max(0, _tqDrag.l + (e.clientX - _tqDrag.sx)) + 'px';
    panel.style.top  = Math.max(0, _tqDrag.t + (e.clientY - _tqDrag.sy)) + 'px';
  }
});
document.addEventListener('mouseup', () => { _tqRes = null; _tqDrag = null; });

// ===================== LOAD ON START =====================
document.addEventListener('DOMContentLoaded', () => {
  loadSheetFromStorage();
  updateAttrPoints(); updatePerPoints();
  addInventoryItem('');
  if (isGM) { loadMonsters(); loadBattleNotes(); loadCombatQueue(); }

  const messagesArea = document.getElementById('messages-area');
  if (messagesArea) {
    messagesArea.addEventListener('scroll', function() {
      _atBottom = this.scrollHeight - this.scrollTop - this.clientHeight < 60;
      if (_atBottom) {
        _unreadCount = 0;
        const btn = document.getElementById('chat-scroll-down');
        if (btn) btn.classList.add('hidden');
      }
    });
  }
});

// ===================== MONSTROS / COMBATE =====================
const MONSTERS_KEY = 'rpg_monsters_v1';
let monsters = {};

const STATUS_EFFECTS = [
  { key: 'sangrando',    label: 'Sangrando',    icon: '🩸' },
  { key: 'nocauteado',   label: 'Nocauteado',   icon: '💤' },
  { key: 'preso',        label: 'Preso',         icon: '🔒' },
  { key: 'em-chamas',    label: 'Em Chamas',     icon: '🔥' },
  { key: 'congelado',    label: 'Congelado',     icon: '❄️' },
  { key: 'envenenado',   label: 'Envenenado',    icon: '☠️' },
  { key: 'atordoado',    label: 'Atordoado',     icon: '😵' },
  { key: 'cego',         label: 'Cego',          icon: '👁️' },
  { key: 'surdo',        label: 'Surdo',         icon: '🔇' },
  { key: 'possuido',     label: 'Possuído',      icon: '👻' },
  { key: 'alucinando',   label: 'Alucinando',    icon: '🌀' },
  { key: 'paralisado',   label: 'Paralisado',    icon: '⚡' },
  { key: 'aterrorizado', label: 'Aterrorizado',  icon: '😱' },
  { key: 'amaldico',     label: 'Amaldiçoado',   icon: '🌑' },
  { key: 'exausto',      label: 'Exausto',       icon: '😮‍💨' },
  { key: 'caido',        label: 'Caído',         icon: '⬇️' },
  { key: 'marcado',      label: 'Marcado',       icon: '🎯' },
  { key: 'protegido',    label: 'Protegido',     icon: '🛡️' },
];

function addMonster() {
  const id = 'mc' + Date.now() + Math.random().toString(36).slice(2, 6);
  monsters[id] = {
    id, name: '', hp: 100, hp_max: 100,
    attrs: { forca: 0, agilidade: 0, defesa: 0, inteligencia: 0, mental: 0 },
    abilities: [], effects: [], notes: ''
  };
  const grid = document.getElementById('monsters-grid');
  if (grid) {
    const card = buildMonsterCard(monsters[id]);
    grid.appendChild(card);
    card.querySelector('.mc-name-input')?.focus();
  }
  saveMonsters();
}

function removeMonster(id) {
  const card = document.getElementById('mcard-' + id);
  if (card) card.remove();
  delete monsters[id];
  saveMonsters();
}

function buildMonsterCard(m) {
  const card = document.createElement('div');
  card.className = 'monster-card';
  card.id = 'mcard-' + m.id;
  const pct = m.hp_max ? Math.max(0, Math.min(100, Math.round(m.hp / m.hp_max * 100))) : 0;
  const hpColor = pct > 50 ? '#4caf50' : pct > 25 ? '#ff9800' : '#e94560';

  const effectsHtml = STATUS_EFFECTS.map(e => {
    const active = (m.effects || []).includes(e.key);
    return `<button class="mc-effect-btn${active ? ' active' : ''}" data-effect="${e.key}" onclick="toggleEffect('${m.id}','${e.key}')" title="${e.label}">${e.icon}</button>`;
  }).join('');

  const absHtml = (m.abilities || []).map((ab, i) => buildAbilityHtml(m.id, ab, i)).join('');

  card.innerHTML = `
    <div class="mc-header">
      <input class="mc-name-input" value="${escHtml(m.name)}" placeholder="Nome do monstro..." oninput="monsters['${m.id}'].name=this.value;saveMonsters()">
      <button class="mc-del-btn" onclick="removeMonster('${m.id}')" title="Remover">✕</button>
    </div>
    <div class="mc-vital">
      <div class="mc-vital-label">❤️ HP</div>
      <div class="mc-vital-row">
        <button class="mc-adj" onclick="adjustHP('${m.id}',-5)">-5</button>
        <button class="mc-adj" onclick="adjustHP('${m.id}',-1)">-1</button>
        <span class="mc-hp-vals">
          <input type="number" class="mc-hp-cur" value="${m.hp}" min="0" onchange="setHP('${m.id}',this.value,null)">
          <span class="mc-hp-sep">/</span>
          <input type="number" class="mc-hp-max" value="${m.hp_max}" min="0" onchange="setHP('${m.id}',null,this.value)">
        </span>
        <button class="mc-adj" onclick="adjustHP('${m.id}',1)">+1</button>
        <button class="mc-adj" onclick="adjustHP('${m.id}',5)">+5</button>
      </div>
      <div class="mc-hp-bar"><div class="mc-hp-fill" style="width:${pct}%;background:${hpColor}"></div></div>
    </div>
    <div class="mc-attrs">
      <div class="mc-attr-item"><label>FÇ</label><input type="number" value="${m.attrs.forca}" min="0" max="20" oninput="updateAttr('${m.id}','forca',this.value)"></div>
      <div class="mc-attr-item"><label>AG</label><input type="number" value="${m.attrs.agilidade}" min="0" max="20" oninput="updateAttr('${m.id}','agilidade',this.value)"></div>
      <div class="mc-attr-item"><label>DEF</label><input type="number" value="${m.attrs.defesa}" min="0" max="20" oninput="updateAttr('${m.id}','defesa',this.value)"></div>
      <div class="mc-attr-item"><label>INT</label><input type="number" value="${m.attrs.inteligencia}" min="0" max="20" oninput="updateAttr('${m.id}','inteligencia',this.value)"></div>
      <div class="mc-attr-item"><label>MEN</label><input type="number" value="${m.attrs.mental}" min="0" max="20" oninput="updateAttr('${m.id}','mental',this.value)"></div>
    </div>
    <div class="mc-effects-wrap">
      <div class="mc-section-label">EFEITOS</div>
      <div class="mc-effects-grid">${effectsHtml}</div>
    </div>
    <div class="mc-abs-wrap">
      <div class="mc-section-label">HABILIDADES</div>
      <div class="mc-abs-list" id="mcabs-${m.id}">${absHtml}</div>
      <button class="mc-add-btn" onclick="addMonsterAbility('${m.id}')">+ Habilidade</button>
    </div>
    <div class="mc-notes-wrap">
      <div class="mc-section-label">ANOTAÇÕES</div>
      <textarea class="mc-notes-input" placeholder="Anotações rápidas..." oninput="monsters['${m.id}'].notes=this.value;saveMonsters()">${escHtml(m.notes)}</textarea>
    </div>
    <div class="mc-calc-wrap">
      <div class="mc-section-label">CALCULADORA</div>
      <input type="text" class="mc-calc-display" id="mcdisp-${m.id}" readonly value="0">
      <div class="mc-calc-btns">
        <button class="mc-calc-btn mc-calc-op" onclick="calcIn('${m.id}','C')">C</button>
        <button class="mc-calc-btn mc-calc-op" onclick="calcIn('${m.id}','toggle_paren')">( )</button>
        <button class="mc-calc-btn mc-calc-op" onclick="calcIn('${m.id}','%')">%</button>
        <button class="mc-calc-btn mc-calc-op" onclick="calcIn('${m.id}','/')">÷</button>
        <button class="mc-calc-btn" onclick="calcIn('${m.id}','7')">7</button>
        <button class="mc-calc-btn" onclick="calcIn('${m.id}','8')">8</button>
        <button class="mc-calc-btn" onclick="calcIn('${m.id}','9')">9</button>
        <button class="mc-calc-btn mc-calc-op" onclick="calcIn('${m.id}','*')">×</button>
        <button class="mc-calc-btn" onclick="calcIn('${m.id}','4')">4</button>
        <button class="mc-calc-btn" onclick="calcIn('${m.id}','5')">5</button>
        <button class="mc-calc-btn" onclick="calcIn('${m.id}','6')">6</button>
        <button class="mc-calc-btn mc-calc-op" onclick="calcIn('${m.id}','-')">−</button>
        <button class="mc-calc-btn" onclick="calcIn('${m.id}','1')">1</button>
        <button class="mc-calc-btn" onclick="calcIn('${m.id}','2')">2</button>
        <button class="mc-calc-btn" onclick="calcIn('${m.id}','3')">3</button>
        <button class="mc-calc-btn mc-calc-op mc-calc-plus" onclick="calcIn('${m.id}','+')">+</button>
        <button class="mc-calc-btn mc-calc-wide" onclick="calcIn('${m.id}','0')">0</button>
        <button class="mc-calc-btn" onclick="calcIn('${m.id}','.')">.</button>
        <button class="mc-calc-btn mc-calc-eq" onclick="calcIn('${m.id}','=')">=</button>
      </div>
    </div>`;
  return card;
}

function buildAbilityHtml(monsterId, ab, i) {
  return `<div class="mc-ab-item">
    <div class="mc-ab-header">
      <input class="mc-ab-name" value="${escHtml(ab.name)}" placeholder="Nome da habilidade..." oninput="updateMonsterAbility('${monsterId}',${i},'name',this.value)">
      <button class="mc-ab-del" onclick="removeMonsterAbility('${monsterId}',${i})">×</button>
    </div>
    <textarea class="mc-ab-desc" placeholder="Efeito / descrição..." oninput="updateMonsterAbility('${monsterId}',${i},'desc',this.value)">${escHtml(ab.desc)}</textarea>
  </div>`;
}

function adjustHP(id, delta) {
  if (!monsters[id]) return;
  monsters[id].hp = Math.max(0, monsters[id].hp + delta);
  refreshHPBar(id);
  saveMonsters();
}

function setHP(id, cur, max) {
  if (!monsters[id]) return;
  if (cur !== null) monsters[id].hp = Math.max(0, parseInt(cur) || 0);
  if (max !== null) monsters[id].hp_max = Math.max(0, parseInt(max) || 0);
  refreshHPBar(id);
  saveMonsters();
}

function refreshHPBar(id) {
  const m = monsters[id]; if (!m) return;
  const card = document.getElementById('mcard-' + id); if (!card) return;
  const pct = m.hp_max ? Math.max(0, Math.min(100, Math.round(m.hp / m.hp_max * 100))) : 0;
  const hpColor = pct > 50 ? '#4caf50' : pct > 25 ? '#ff9800' : '#e94560';
  const fill = card.querySelector('.mc-hp-fill');
  if (fill) { fill.style.width = pct + '%'; fill.style.background = hpColor; }
  const curEl = card.querySelector('.mc-hp-cur');
  if (curEl) curEl.value = m.hp;
}

function updateAttr(id, attr, value) {
  if (!monsters[id]) return;
  monsters[id].attrs[attr] = parseInt(value) || 0;
  saveMonsters();
}

function toggleEffect(id, key) {
  if (!monsters[id]) return;
  const effs = monsters[id].effects;
  const idx = effs.indexOf(key);
  if (idx >= 0) effs.splice(idx, 1); else effs.push(key);
  const card = document.getElementById('mcard-' + id);
  if (card) {
    const btn = card.querySelector(`.mc-effect-btn[data-effect="${key}"]`);
    if (btn) btn.classList.toggle('active', effs.includes(key));
  }
  saveMonsters();
}

function addMonsterAbility(id) {
  if (!monsters[id]) return;
  const i = monsters[id].abilities.length;
  monsters[id].abilities.push({ name: '', desc: '' });
  const list = document.getElementById('mcabs-' + id);
  if (list) list.insertAdjacentHTML('beforeend', buildAbilityHtml(id, { name: '', desc: '' }, i));
  saveMonsters();
}

function updateMonsterAbility(id, idx, field, value) {
  if (!monsters[id] || !monsters[id].abilities[idx]) return;
  monsters[id].abilities[idx][field] = value;
  saveMonsters();
}

function removeMonsterAbility(id, idx) {
  if (!monsters[id]) return;
  monsters[id].abilities.splice(idx, 1);
  const card = document.getElementById('mcard-' + id);
  if (card) card.replaceWith(buildMonsterCard(monsters[id]));
  saveMonsters();
}

function saveMonsters() {
  try { localStorage.setItem(MONSTERS_KEY, JSON.stringify(monsters)); } catch(e) {}
}

function loadMonsters() {
  try {
    const raw = localStorage.getItem(MONSTERS_KEY);
    if (raw) monsters = JSON.parse(raw);
  } catch(e) {}
  const grid = document.getElementById('monsters-grid');
  if (!grid) return;
  grid.innerHTML = '';
  for (const m of Object.values(monsters)) grid.appendChild(buildMonsterCard(m));
}

// ===== CALCULADORA POR MONSTRO =====
const calcState = {};

function calcIn(id, key) {
  if (!calcState[id]) calcState[id] = { expr: '', display: '0', afterEq: false };
  const s = calcState[id];
  const disp = document.getElementById('mcdisp-' + id);

  if (key === 'C') {
    s.expr = ''; s.display = '0'; s.afterEq = false;
  } else if (key === 'toggle_paren') {
    const opens = (s.expr.match(/\(/g) || []).length;
    const closes = (s.expr.match(/\)/g) || []).length;
    const paren = opens > closes ? ')' : '(';
    if (s.afterEq) { s.expr = paren; s.afterEq = false; }
    else { s.expr += paren; }
    s.display = s.expr;
  } else if (key === '=') {
    try {
      const safe = s.expr.replace(/[^0-9\+\-\*\/\.\(\)%\s]/g, '');
      if (!safe) throw new Error();
      // eslint-disable-next-line no-new-func
      const result = Function('"use strict";return(' + safe + ')')();
      const v = Math.round(result * 100000) / 100000;
      s.display = isFinite(v) ? String(v) : 'Erro';
      s.expr = isFinite(v) ? s.display : '';
      s.afterEq = true;
    } catch(e) { s.display = 'Erro'; s.expr = ''; s.afterEq = false; }
  } else {
    const isOp = /^[\+\-\*\/\(%]$/.test(key);
    if (s.afterEq) {
      s.expr = isOp ? s.display + key : key;
      s.afterEq = false;
    } else if (s.display === '0' && !isOp && key !== '.') {
      s.expr = key;
    } else {
      s.expr += key;
    }
    s.display = s.expr;
  }

  if (disp) disp.value = s.display || '0';
}

// ===== NOTAS DA SESSÃO (painel esquerdo da batalha) =====
const BATTLE_NOTES_KEY = 'rpg_gm_session_notes_v1';

function saveBattleNotes(value) {
  try { localStorage.setItem(BATTLE_NOTES_KEY, value); } catch(e) {}
}

function loadBattleNotes() {
  const ta = document.getElementById('gm-battle-notes');
  if (ta) ta.value = localStorage.getItem(BATTLE_NOTES_KEY) || '';
}
