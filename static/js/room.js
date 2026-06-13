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

// ===================== SOCKET =====================
const socket = io({ transports: ['websocket', 'polling'] });

socket.on('connect', () => {
  socket.emit('join', { room_id: ROOM_ID, player_name: playerName, is_gm: isGM, token: SESSION_TOKEN });
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
  for (const [sid, p] of Object.entries(players)) {
    const color = playerColor(sid);
    const v = p.vitals || {};
    const vidaPct  = v.vida_max  ? Math.min(100, Math.round((v.vida  || 0) / v.vida_max  * 100)) : 0;
    const sanPct   = v.sanidade_max ? Math.min(100, Math.round((v.sanidade || 0) / v.sanidade_max * 100)) : 0;
    const enPct    = v.energia_max  ? Math.min(100, Math.round((v.energia  || 0) / v.energia_max  * 100)) : 0;
    const hasVitals = v.vida_max || v.sanidade_max || v.energia_max;
    const avatarHtml = v.avatar
      ? `<img src="${v.avatar}" alt="">`
      : `<span>${(p.name || '?')[0].toUpperCase()}</span>`;
    const gmBadge = p.is_gm ? '<span class="pc-gm-badge">GM</span>' : '';
    const charName = v.char_name ? `<div class="pc-char">${v.char_name}</div>` : '';
    const vitalsHtml = hasVitals ? `
      <div class="pc-vitals">
        <div class="pc-bar-row"><span class="pc-bar-icon">❤️</span><div class="pc-bar-wrap"><div class="pc-bar-fill vida" style="width:${vidaPct}%"></div></div><span class="pc-bar-val">${v.vida||0}/${v.vida_max||0}</span></div>
        <div class="pc-bar-row"><span class="pc-bar-icon">🧠</span><div class="pc-bar-wrap"><div class="pc-bar-fill sanidade" style="width:${sanPct}%"></div></div><span class="pc-bar-val">${v.sanidade||0}/${v.sanidade_max||0}</span></div>
        <div class="pc-bar-row"><span class="pc-bar-icon">⚡</span><div class="pc-bar-wrap"><div class="pc-bar-fill energia" style="width:${enPct}%"></div></div><span class="pc-bar-val">${v.energia||0}/${v.energia_max||0}</span></div>
      </div>` : '';
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
});

let _msgHandler = null;
if (_msgHandler) socket.off('new_message', _msgHandler);
_msgHandler = (msg) => {
  appendMessage(msg);
  if (msg.type === 'roll') showDice3D(msg.total, msg.rolls?.[0] || msg.total, msg.author);
  if (msg.type === 'roll') addDiceHistory(msg);
};
socket.on('new_message', _msgHandler);

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
  const row = document.createElement('div');
  const authorColor = getAuthorColor(msg.author);
  const time = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

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
  if (area) area.scrollTop = area.scrollHeight;
}

function sendChat() {
  const input = document.getElementById('chat-input');
  const text = (input.value || '').trim();
  if (!text) return;
  socket.emit('chat_message', { room_id: ROOM_ID, text });
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

function rollDice(sides) {
  const count = parseInt(document.getElementById('dice-count').value) || 1;
  const mod = parseInt(document.getElementById('dice-mod').value) || 0;
  socket.emit('roll_dice', { room_id: ROOM_ID, dice: sides, count, modifier: mod });
}

function rollCustom() {
  const sides = prompt('Quantas faces? (ex: 6, 12, 20)');
  if (!sides || isNaN(sides)) return;
  const count = parseInt(document.getElementById('dice-count').value) || 1;
  const mod = parseInt(document.getElementById('dice-mod').value) || 0;
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
let selectedTokenId = null;
let draggingToken = null, dragOffX = 0, dragOffY = 0;
let contextMenuToken = null;
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
  if (currentTool === 'measure' && measureStart && measureEnd) drawMeasure();

  mapCtx.restore();

  for (const tok of Object.values(tokens)) drawToken(tok);
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
  mapCtx.save();
  mapCtx.strokeStyle = '#ff9800'; mapCtx.lineWidth = 2 / mapZoom; mapCtx.setLineDash([6, 4]);
  mapCtx.beginPath(); mapCtx.moveTo(measureStart.x, measureStart.y); mapCtx.lineTo(measureEnd.x, measureEnd.y); mapCtx.stroke();
  mapCtx.setLineDash([]);
  const dist = Math.round(Math.hypot(measureEnd.x - measureStart.x, measureEnd.y - measureStart.y) / mapState.grid_size * 10) / 10;
  const badge = document.getElementById('measure-display');
  if (badge) { badge.textContent = dist + ' quadrados'; badge.style.display = 'inline'; }
  mapCtx.restore();
}

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
  mapCtx.font = `${sr * 0.9}px serif`;
  mapCtx.textAlign = 'center'; mapCtx.textBaseline = 'middle';
  mapCtx.fillText(tok.emoji || '⚔️', sx, sy);
  mapCtx.font = `bold ${Math.max(10, sr * 0.35)}px sans-serif`;
  mapCtx.fillStyle = '#fff'; mapCtx.strokeStyle = 'rgba(0,0,0,0.8)'; mapCtx.lineWidth = 2;
  mapCtx.strokeText(tok.name || '', sx, sy + sr + 10);
  mapCtx.fillText(tok.name || '', sx, sy + sr + 10);
  if (tok.hp_max) {
    const bw = sr * 1.6, bh = 5;
    const bx = sx - bw / 2, by = sy + sr + 4;
    mapCtx.fillStyle = '#333'; mapCtx.fillRect(bx, by, bw, bh);
    const pct = Math.max(0, Math.min(1, (tok.hp || 0) / tok.hp_max));
    mapCtx.fillStyle = pct > 0.5 ? '#4caf50' : pct > 0.25 ? '#ff9800' : '#e94560';
    mapCtx.fillRect(bx, by, bw * pct, bh);
  }
  mapCtx.restore();
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
  const mp = screenToMap(e.clientX - rect.left, e.clientY - rect.top);
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
  }
  hideContextMenu();
  contextMenuToken = null;
}

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
function openAddToken() {
  if (!isGM) return;
  document.getElementById('token-name').value = '';
  document.getElementById('token-hp').value = '';
  document.getElementById('token-hp-max').value = '';
  document.getElementById('modal-token').classList.remove('hidden');
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
  const tok = { id, name, color: selectedTokenColor, emoji: selectedTokenEmoji, hp, hp_max: hpMax, x: gs * 2, y: gs * 2, size: gs * 0.9 };
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
  const san = prompt('Sanidade atual:', v.sanidade || 0);
  const sanMax = prompt('Sanidade máx:', v.sanidade_max || 50);
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

function openSheet() {
  loadSheetFromStorage();
  document.getElementById('modal-sheet').classList.remove('hidden');
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}

function saveSheet() {
  const sheet = gatherSheet();
  localStorage.setItem(SHEET_KEY, JSON.stringify(sheet));
  socket.emit('share_sheet', { room_id: ROOM_ID, sheet });
  closeModal('modal-sheet');
}

function gatherSheet() {
  const fields = ['name','age','height','weight','appearance','origin','forca','agilidade','inteligencia','mental','labia','furtividade','defesa','investigacao','sobrevivencia','ocultismo','religiao','medicina','intuicao','vida','vida-max','sanidade','sanidade-max','energia','energia-max','xp','nivel','equipamentos','personalidade','nao-pode','mais-ama','mais-odeia','mais-teme','historia','anotacoes'];
  const s = {};
  for (const f of fields) {
    const el = document.getElementById('sh-' + f.replace('-','_').replace('-','_'));
    if (el) s[f] = el.value || '';
  }
  s['vida-max'] = (document.getElementById('sh-vida-max')||{}).value || '';
  s['sanidade-max'] = (document.getElementById('sh-sanidade-max')||{}).value || '';
  s['energia-max'] = (document.getElementById('sh-energia-max')||{}).value || '';
  s['nao-pode'] = (document.getElementById('sh-nao_pode')||document.getElementById('sh-nao-pode')||{}).value || '';
  s['mais-ama'] = (document.getElementById('sh-mais_ama')||document.getElementById('sh-mais-ama')||{}).value || '';
  s['mais-odeia'] = (document.getElementById('sh-mais_odeia')||document.getElementById('sh-mais-odeia')||{}).value || '';
  s['mais-teme'] = (document.getElementById('sh-mais_teme')||document.getElementById('sh-mais-teme')||{}).value || '';
  s['attr-max'] = (document.getElementById('sh-attr-max')||{}).value || '16';
  s['per-max'] = (document.getElementById('sh-per-max')||{}).value || '7';
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
      desc: hab.querySelector('.hab-desc')?.value || ''
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
  const simple = ['name','age','height','weight','appearance','forca','agilidade','inteligencia','mental','labia','furtividade','defesa','investigacao','sobrevivencia','ocultismo','religiao','medicina','intuicao','vida','sanidade','energia','xp','nivel','equipamentos','personalidade','historia','anotacoes','origin'];
  for (const f of simple) {
    const el = document.getElementById('sh-' + f);
    if (el && s[f] !== undefined) el.value = s[f];
  }
  const vmax = (k, elid) => { const el = document.getElementById(elid); if (el && s[k] !== undefined) el.value = s[k]; };
  vmax('vida-max', 'sh-vida-max'); vmax('sanidade-max', 'sh-sanidade-max'); vmax('energia-max', 'sh-energia-max');
  vmax('attr-max', 'sh-attr-max'); vmax('per-max', 'sh-per-max');
  const naoEl = document.getElementById('sh-nao_pode'); if (naoEl && s['nao-pode'] !== undefined) naoEl.value = s['nao-pode'];
  const amaEl = document.getElementById('sh-mais_ama'); if (amaEl && s['mais-ama'] !== undefined) amaEl.value = s['mais-ama'];
  const odeiaEl = document.getElementById('sh-mais_odeia'); if (odeiaEl && s['mais-odeia'] !== undefined) odeiaEl.value = s['mais-odeia'];
  const temeEl = document.getElementById('sh-mais_teme'); if (temeEl && s['mais-teme'] !== undefined) temeEl.value = s['mais-teme'];
  if (s.classes) {
    if (document.getElementById('sh-cls-sentitivo')) document.getElementById('sh-cls-sentitivo').checked = s.classes.sentitivo;
    if (document.getElementById('sh-cls-possuido')) document.getElementById('sh-cls-possuido').checked = s.classes.possuido;
    if (document.getElementById('sh-cls-feiticeiro')) document.getElementById('sh-cls-feiticeiro').checked = s.classes.feiticeiro;
    if (document.getElementById('sh-cls-santificado')) document.getElementById('sh-cls-santificado').checked = s.classes.santificado;
  }
  const invList = document.getElementById('sh-inventory-list');
  if (invList) {
    invList.innerHTML = '';
    (s.inventory || []).forEach(item => addInventoryItem(item));
  }
  const habList = document.getElementById('sh-habilidades-list');
  if (habList) {
    habList.innerHTML = '';
    (s.habilidades || []).forEach(h => addHabilidade(h));
  }
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

function addHabilidade(data = {}) {
  const list = document.getElementById('sh-habilidades-list');
  if (!list) return;
  const item = document.createElement('div'); item.className = 'hab-item';
  item.innerHTML = `
    <div class="hab-row">
      <input type="text" class="hab-name" placeholder="Nome da habilidade" value="${data.name||''}">
      <input type="text" class="hab-cost" placeholder="Custo" value="${data.cost||''}">
      <button class="hab-del" onclick="this.closest('.hab-item').remove()">×</button>
    </div>
    <textarea class="hab-desc" placeholder="Descrição...">${data.desc||''}</textarea>`;
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

// ===================== LOAD ON START =====================
document.addEventListener('DOMContentLoaded', () => {
  loadSheetFromStorage();
  updateAttrPoints(); updatePerPoints();
  addInventoryItem('');
});
