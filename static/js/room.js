// ===================== CONEXÃO =====================
const ROOM_ID = window.ROOM_ID;
const playerName = sessionStorage.getItem('player_name') || 'Jogador';
const isGM = sessionStorage.getItem('is_gm') === '1';

// Token de sessão único por aba — persiste durante reconexões, mas muda em nova aba
function getSessionToken() {
  let t = sessionStorage.getItem('rpg_session_token');
  if (!t) {
    t = 'tk-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    sessionStorage.setItem('rpg_session_token', t);
  }
  return t;
}
const SESSION_TOKEN = getSessionToken();

const socket = io();

socket.on('connect', () => {
  socket.emit('join', { room_id: ROOM_ID, player_name: playerName, is_gm: isGM, token: SESSION_TOKEN });
});

socket.on('kicked', (data) => {
  document.body.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;height:100vh;background:#1a1a2e;color:#e0e0e0;font-family:sans-serif;flex-direction:column;gap:16px">
      <div style="font-size:3rem">⚠️</div>
      <h2 style="color:#e94560">Sessão encerrada</h2>
      <p style="color:#aaa">${data.reason || 'Você foi desconectado.'}</p>
      <a href="/" style="background:#e94560;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600">Voltar ao início</a>
    </div>`;
  socket.disconnect();
});

socket.on('room_state', (data) => {
  Object.keys(tokens).forEach(k => delete tokens[k]);
  for (const [id, token] of Object.entries(data.tokens)) tokens[id] = token;

  for (const msg of data.messages) {
    renderFChatMessage(msg);
    if (msg.type === 'roll') renderDiceHistory(msg);
  }

  if (data.map) Object.assign(mapState, data.map);
  if (data.map && data.map.background) loadBgFromUrl(data.map.background);

  redraw();
  if (data.map) syncGridPanel(data.map);
  // players chegam logo depois via player_list
});

// Fonte única de verdade para a lista de jogadores
socket.on('player_list', (data) => {
  Object.keys(players).forEach(k => delete players[k]);
  const localVitals = JSON.parse(localStorage.getItem('rpg_sheet_v2') || '{}')._vitals_cache || {};
  for (const [sid, p] of Object.entries(data)) {
    players[sid] = { ...p };
    if (sid === socket.id) {
      // usa vitais locais para si mesmo (mais atualizado)
      players[sid].vitals = localVitals;
      players[sid].name = playerName;
      players[sid].is_gm = isGM;
    }
  }
  renderPlayers();
  redraw();
});
socket.on('new_message', (msg) => {
  renderFChatMessage(msg);    // chat flutuante — todas as mensagens
  if (msg.type === 'roll') renderDiceHistory(msg); // histórico de dados no sidebar
});
socket.on('player_vitals_updated', (data) => {
  if (players[data.sid]) {
    players[data.sid].vitals = data.vitals;
    if (data.vitals.avatar) players[data.sid].avatar = data.vitals.avatar;
    if (data.vitals.char_name) players[data.sid].char_name = data.vitals.char_name;
  }
  renderPlayers();
  redraw();
});
socket.on('player_sheet_data', (data) => {
  openGMSheet(data.sid, data.sheet);
});
socket.on('token_added', (t) => { tokens[t.id] = t; redraw(); });
socket.on('token_moved', (d) => { if (tokens[d.token_id]) { tokens[d.token_id].x = d.x; tokens[d.token_id].y = d.y; } redraw(); });
socket.on('token_removed', (d) => { delete tokens[d.token_id]; redraw(); });
socket.on('token_updated', (t) => { tokens[t.id] = { ...tokens[t.id], ...t }; redraw(); });
socket.on('map_updated', (m) => {
  Object.assign(mapState, m);
  if (m.background) loadBgFromUrl(m.background);
  redraw();
});

// ===================== ESTADO =====================
const tokens = {};
const players = {};
let mapState = {
  show_grid: true, grid_size: 50, width: 3000, height: 2000, background: null,
  grid_color: '#ffffff', grid_opacity: 0.15, grid_type: 'square', snap: true
};
let bgImage = null;
let currentTool = 'select';
let zoom = 1;
let panX = 0, panY = 0;
let isDragging = false;
let dragToken = null;
let dragOffX = 0, dragOffY = 0;
let isPanning = false;
let panStartX = 0, panStartY = 0;
let panOriginX = 0, panOriginY = 0;
let measureStart = null;
let measureEnd = null;
let selectedTokenId = null;
let selectedColor = '#e94560';
let selectedEmoji = '⚔️';
let contextTokenId = null;

// ===================== CANVAS =====================
const canvas = document.getElementById('map-canvas');
const ctx = canvas.getContext('2d');

function resizeCanvas() {
  const container = document.getElementById('map-container');
  canvas.width = container.clientWidth;
  canvas.height = container.clientHeight;
  redraw();
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function redraw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(panX, panY);
  ctx.scale(zoom, zoom);

  // Background
  if (bgImage) {
    ctx.drawImage(bgImage, 0, 0, mapState.width, mapState.height);
  } else {
    ctx.fillStyle = '#111827';
    ctx.fillRect(0, 0, mapState.width, mapState.height);
  }

  // Grid
  if (mapState.show_grid) drawGrid();

  // Tokens
  for (const token of Object.values(tokens)) drawToken(token);

  // Measure
  if (measureStart && measureEnd) drawMeasure();

  ctx.restore();
}

function drawGrid() {
  const gs = mapState.grid_size;
  const col = mapState.grid_color || '#ffffff';
  const op = mapState.grid_opacity ?? 0.15;
  const hex = (mapState.grid_type === 'hex');

  // Parse color to rgba
  const r = parseInt(col.slice(1,3),16), g = parseInt(col.slice(3,5),16), b = parseInt(col.slice(5,7),16);
  ctx.strokeStyle = `rgba(${r},${g},${b},${op})`;
  ctx.lineWidth = 1 / zoom;

  if (hex) {
    // Hexagonal flat-top
    const w = gs;
    const h = gs * Math.sqrt(3) / 2;
    ctx.beginPath();
    for (let row = 0; row * h < mapState.height + h; row++) {
      for (let col2 = 0; col2 * w * 0.75 < mapState.width + w; col2++) {
        const cx = col2 * w * 0.75;
        const cy = row * h * 2 + (col2 % 2 === 0 ? 0 : h);
        for (let i = 0; i < 6; i++) {
          const angle = Math.PI / 180 * (60 * i - 30);
          const x = cx + gs / 2 * Math.cos(angle);
          const y = cy + gs / 2 * Math.sin(angle);
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.closePath();
      }
    }
    ctx.stroke();
  } else {
    ctx.beginPath();
    for (let x = 0; x <= mapState.width; x += gs) {
      ctx.moveTo(x, 0); ctx.lineTo(x, mapState.height);
    }
    for (let y = 0; y <= mapState.height; y += gs) {
      ctx.moveTo(0, y); ctx.lineTo(mapState.width, y);
    }
    ctx.stroke();
  }
}

const tokenImageCache = {};

function drawToken(token) {
  const gs = mapState.grid_size;
  const cx = token.x * gs + gs / 2;
  const cy = token.y * gs + gs / 2;
  const r = gs * 0.42;
  const isSelected = token.id === selectedTokenId;

  ctx.shadowColor = token.color;
  ctx.shadowBlur = isSelected ? 18 : 8;

  // Circle
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = token.color;
  ctx.fill();
  if (isSelected) {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3 / zoom;
    ctx.stroke();
  }
  ctx.shadowBlur = 0;

  // Avatar image or emoji
  if (token.avatarUrl) {
    if (!tokenImageCache[token.id]) {
      const img = new Image();
      img.src = token.avatarUrl;
      img.onload = () => { tokenImageCache[token.id] = img; redraw(); };
      tokenImageCache[token.id] = null;
    }
    const img = tokenImageCache[token.id];
    if (img) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r - 2/zoom, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
      ctx.restore();
    }
  } else {
    const emojiSize = gs * 0.5;
    ctx.font = `${emojiSize}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(token.emoji || '?', cx, cy);
  }

  // Name
  ctx.font = `bold ${gs * 0.22}px Segoe UI`;
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(token.name, cx, cy + r + 3 / zoom);

  // HP bar
  if (token.hp !== undefined && token.hp !== null && token.hp_max) {
    const barW = gs * 0.8;
    const barH = gs * 0.1;
    const bx = cx - barW / 2;
    const by = cy + r + gs * 0.28;
    const ratio = Math.max(0, Math.min(1, token.hp / token.hp_max));
    ctx.fillStyle = '#333';
    ctx.fillRect(bx, by, barW, barH);
    ctx.fillStyle = ratio > 0.5 ? '#4CAF50' : ratio > 0.25 ? '#FF9800' : '#e94560';
    ctx.fillRect(bx, by, barW * ratio, barH);
  }
}

function drawMeasure() {
  const gs = mapState.grid_size;
  const x1 = measureStart.x * gs + gs / 2;
  const y1 = measureStart.y * gs + gs / 2;
  const x2 = measureEnd.x * gs + gs / 2;
  const y2 = measureEnd.y * gs + gs / 2;
  const dx = measureEnd.x - measureStart.x;
  const dy = measureEnd.y - measureStart.y;
  const dist = Math.sqrt(dx * dx + dy * dy).toFixed(1);

  ctx.strokeStyle = '#FFD700';
  ctx.lineWidth = 2 / zoom;
  ctx.setLineDash([6 / zoom, 4 / zoom]);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.setLineDash([]);

  const el = document.getElementById('measure-display');
  el.textContent = `${dist} quadrados`;
  el.style.display = 'block';
}

// ===================== MOUSE EVENTS =====================
function canvasToWorld(cx, cy) {
  return { x: (cx - panX) / zoom, y: (cy - panY) / zoom };
}
function worldToGrid(wx, wy) {
  const gs = mapState.grid_size;
  return { x: Math.floor(wx / gs), y: Math.floor(wy / gs) };
}

function getTokenAt(gx, gy) {
  for (const token of Object.values(tokens)) {
    if (token.x === gx && token.y === gy) return token;
  }
  return null;
}

canvas.addEventListener('mousedown', (e) => {
  if (e.button === 2) return;
  const world = canvasToWorld(e.clientX - canvas.getBoundingClientRect().left, e.clientY - canvas.getBoundingClientRect().top);
  const grid = worldToGrid(world.x, world.y);
  hideContextMenu();

  if (currentTool === 'move') {
    isPanning = true;
    panStartX = e.clientX;
    panStartY = e.clientY;
    panOriginX = panX;
    panOriginY = panY;
    canvas.style.cursor = 'grabbing';
    return;
  }

  if (currentTool === 'measure') {
    measureStart = grid;
    measureEnd = grid;
    return;
  }

  // select tool
  const token = getTokenAt(grid.x, grid.y);
  if (token) {
    dragToken = token;
    dragOffX = world.x - token.x * mapState.grid_size;
    dragOffY = world.y - token.y * mapState.grid_size;
    selectedTokenId = token.id;
    isDragging = true;
  } else {
    selectedTokenId = null;
    // start pan with middle button or space held
    if (e.button === 1 || spaceHeld) {
      isPanning = true;
      panStartX = e.clientX;
      panStartY = e.clientY;
      panOriginX = panX;
      panOriginY = panY;
    }
  }
  redraw();
});

canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  const world = canvasToWorld(e.clientX - rect.left, e.clientY - rect.top);
  const grid = worldToGrid(world.x, world.y);

  if (isPanning) {
    panX = panOriginX + (e.clientX - panStartX);
    panY = panOriginY + (e.clientY - panStartY);
    redraw();
    return;
  }

  if (currentTool === 'measure' && measureStart) {
    measureEnd = grid;
    redraw();
    return;
  }

  if (isDragging && dragToken) {
    const gs = mapState.grid_size;
    const newGX = Math.floor((world.x - dragOffX + gs / 2) / gs);
    const newGY = Math.floor((world.y - dragOffY + gs / 2) / gs);
    if (newGX !== dragToken.x || newGY !== dragToken.y) {
      dragToken.x = newGX;
      dragToken.y = newGY;
      socket.emit('token_move', { room_id: ROOM_ID, token_id: dragToken.id, x: newGX, y: newGY });
      redraw();
    }
  }
});

canvas.addEventListener('mouseup', () => {
  isDragging = false;
  dragToken = null;
  isPanning = false;
  canvas.style.cursor = currentTool === 'move' ? 'grab' : 'default';
});

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const world = canvasToWorld(e.clientX - rect.left, e.clientY - rect.top);
  const grid = worldToGrid(world.x, world.y);
  const token = getTokenAt(grid.x, grid.y);
  if (token) {
    contextTokenId = token.id;
    selectedTokenId = token.id;
    showContextMenu(e.clientX, e.clientY);
    redraw();
  }
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const delta = e.deltaY > 0 ? 0.9 : 1.1;
  const newZoom = Math.min(3, Math.max(0.2, zoom * delta));
  panX = mx - (mx - panX) * (newZoom / zoom);
  panY = my - (my - panY) * (newZoom / zoom);
  zoom = newZoom;
  document.getElementById('zoom-info').textContent = Math.round(zoom * 100) + '%';
  redraw();
}, { passive: false });

let spaceHeld = false;
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && e.target === document.body) { spaceHeld = true; e.preventDefault(); }
  if (e.key === 's' && e.target === document.body) setTool('select');
  if (e.key === 'm' && e.target === document.body) setTool('move');
  if (e.key === 'r' && e.target === document.body) setTool('measure');
  if (e.key === 'Delete' && selectedTokenId && e.target === document.body) removeToken(selectedTokenId);
});
document.addEventListener('keyup', (e) => { if (e.code === 'Space') spaceHeld = false; });

// ===================== FERRAMENTAS =====================
function setTool(tool) {
  currentTool = tool;
  document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`tool-${tool}`)?.classList.add('active');
  canvas.style.cursor = tool === 'move' ? 'grab' : 'default';
  if (tool !== 'measure') {
    measureStart = null; measureEnd = null;
    document.getElementById('measure-display').style.display = 'none';
  }
  redraw();
}

function toggleGrid() {
  mapState.show_grid = !mapState.show_grid;
  const cb = document.getElementById('grid-visible');
  if (cb) cb.checked = mapState.show_grid;
  socket.emit('map_update', { room_id: ROOM_ID, map: { show_grid: mapState.show_grid } });
  redraw();
}

// ===================== TOKENS =====================
function openAddToken() {
  document.getElementById('modal-token').classList.remove('hidden');
  document.getElementById('token-name').focus();
}

function pickColor(el) {
  document.querySelectorAll('.color-opt').forEach(e => e.classList.remove('selected'));
  el.classList.add('selected');
  selectedColor = el.dataset.color;
}
function pickEmoji(el) {
  document.querySelectorAll('.emoji-opt').forEach(e => e.classList.remove('selected'));
  el.classList.add('selected');
  selectedEmoji = el.dataset.emoji;
}

function addToken() {
  const name = document.getElementById('token-name').value.trim() || 'Token';
  const hp = document.getElementById('token-hp').value;
  const hpMax = document.getElementById('token-hp-max').value;
  const id = 't_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
  const token = {
    id, name, color: selectedColor, emoji: selectedEmoji,
    x: Math.floor(((-panX / zoom) + canvas.width / zoom / 2) / mapState.grid_size),
    y: Math.floor(((-panY / zoom) + canvas.height / zoom / 2) / mapState.grid_size),
    hp: hp !== '' ? parseInt(hp) : null,
    hp_max: hpMax !== '' ? parseInt(hpMax) : null,
  };
  tokens[id] = token;
  socket.emit('token_add', { room_id: ROOM_ID, token });
  closeModal('modal-token');
  document.getElementById('token-name').value = '';
  document.getElementById('token-hp').value = '';
  document.getElementById('token-hp-max').value = '';
  redraw();
}

function removeToken(id) {
  delete tokens[id];
  if (selectedTokenId === id) selectedTokenId = null;
  socket.emit('token_remove', { room_id: ROOM_ID, token_id: id });
  redraw();
}

// ===================== CONTEXT MENU =====================
function showContextMenu(x, y) {
  const menu = document.getElementById('token-menu');
  menu.classList.remove('hidden');
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
}
function hideContextMenu() { document.getElementById('token-menu').classList.add('hidden'); }

function tokenMenuAction(action) {
  hideContextMenu();
  const token = tokens[contextTokenId];
  if (!token) return;
  if (action === 'remove') {
    removeToken(contextTokenId);
  } else if (action === 'hp') {
    const val = prompt(`HP de ${token.name} (atual: ${token.hp ?? '?'} / ${token.hp_max ?? '?'})\nNovo HP:`);
    if (val !== null) {
      token.hp = parseInt(val) || 0;
      socket.emit('token_update', { room_id: ROOM_ID, token: { id: token.id, hp: token.hp } });
      redraw();
    }
  } else if (action === 'edit') {
    const val = prompt(`Nome do token:`, token.name);
    if (val !== null && val.trim()) {
      token.name = val.trim();
      socket.emit('token_update', { room_id: ROOM_ID, token: { id: token.id, name: token.name } });
      redraw();
    }
  }
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('#token-menu')) hideContextMenu();
});

// ===================== CHAT / MENSAGENS =====================
function sendChat() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;
  socket.emit('chat_message', { room_id: ROOM_ID, text });
  input.value = '';
}
function chatKeydown(e) { if (e.key === 'Enter') sendChat(); }

function rollDice(sides) {
  const count = parseInt(document.getElementById('dice-count').value) || 1;
  const mod = parseInt(document.getElementById('dice-mod').value) || 0;
  showDice3D(sides, () => {
    socket.emit('roll_dice', { room_id: ROOM_ID, dice: sides, count, modifier: mod });
  });
}
function rollCustom() {
  const sides = parseInt(prompt('Quantos lados? (ex: 20)'));
  if (!sides || sides < 2) return;
  rollDice(sides);
}

function showDice3D(sides, callback) {
  const overlay = document.getElementById('dice-overlay');
  const cube = document.getElementById('dice-3d-cube');
  const result = document.getElementById('dice-result-display');

  const colors = {4:'#9C27B0',6:'#2196F3',8:'#4CAF50',10:'#FF9800',12:'#00BCD4',20:'#e94560',100:'#607D8B'};
  const col = colors[sides] || '#e94560';
  const label = sides === 100 ? 'd%' : `d${sides}`;

  document.querySelectorAll('.face').forEach(f => {
    f.style.borderColor = col + 'aa';
    f.style.background = 'rgba(8,4,12,0.95)';
    f.innerHTML = `<span style="color:${col};font-size:1.2rem;font-weight:900;text-shadow:0 0 12px ${col}">${label}</span>`;
  });
  document.getElementById('dice-3d-scene').style.filter = `drop-shadow(0 0 24px ${col})`;

  result.innerHTML = '';
  overlay.classList.remove('hidden');

  // Reinicia animação CSS
  cube.style.animation = 'none';
  cube.offsetHeight;
  cube.style.animation = 'diceRoll 1.4s cubic-bezier(0.23,1,0.32,1) forwards';

  // Registra listener ANTES de enviar o dado
  let settled = false;
  const handler = (msg) => {
    if (msg.type !== 'roll') return; // ignora chat e system
    if (settled) return;
    settled = true;
    socket.off('new_message', handler);

    const match = msg.text.match(/\*\*(\d+)\*\*/);
    const valor = match ? match[1] : '?';
    result.innerHTML = `
      <div style="font-size:0.9rem;color:#888;letter-spacing:1px;margin-bottom:6px">${escHtml(msg.author)} · ${label}</div>
      <div style="font-size:4rem;font-weight:900;color:${col};text-shadow:0 0 30px ${col}80;line-height:1">${valor}</div>`;
    setTimeout(() => { overlay.classList.add('hidden'); }, 2500);
  };
  socket.on('new_message', handler);

  // Envia o roll
  if (callback) callback();

  // Fallback: fecha overlay se não receber resposta em 6s
  setTimeout(() => {
    if (!settled) {
      settled = true;
      socket.off('new_message', handler);
      overlay.classList.add('hidden');
    }
  }, 6000);
}

// renderMessage mantido apenas para compatibilidade — redireciona para fchat
function renderMessage(msg) {
  renderFChatMessage(msg);
  if (msg.type === 'roll') renderDiceHistory(msg);
}

// Histórico de rolagens no sidebar
function renderDiceHistory(msg) {
  const container = document.getElementById('dice-history');
  if (!container) return;
  const el = document.createElement('div');
  el.className = 'msg msg-roll';
  const rendered = msg.text.replace(/\*\*(.+?)\*\*/g, '<span class="roll-total">$1</span>');
  el.innerHTML = `<span class="author">${escHtml(msg.author)}</span>${rendered}`;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ===================== JOGADORES =====================
function renderPlayers() {
  const el = document.getElementById('players-list');
  if (!el) return;
  el.innerHTML = '';
  for (const [sid, p] of Object.entries(players)) {
    const v = p.vitals || {};
    const vidaRatio  = v.vida_max  ? Math.min(1, Math.max(0, (v.vida     || 0) / v.vida_max))  : 0;
    const sanRatio   = v.sanidade_max ? Math.min(1, Math.max(0, (v.sanidade || 0) / v.sanidade_max)) : 0;
    const enRatio    = v.energia_max  ? Math.min(1, Math.max(0, (v.energia  || 0) / v.energia_max))  : 0;

    const avatarHtml = (v.avatar || p.avatar)
      ? `<img src="${v.avatar || p.avatar}" alt="">`
      : `<span>${p.name[0].toUpperCase()}</span>`;

    const isMine = (sid === socket.id);
    const canEdit = isMine || isGM;
    const disabled = canEdit ? '' : 'disabled';

    const card = document.createElement('div');
    card.className = 'player-card' + (p.is_gm ? ' player-card-gm' : '');
    card.dataset.sid = sid;
    card.innerHTML = `
      <div class="player-card-header">
        <div class="player-avatar-img">${avatarHtml}</div>
        <div class="player-card-info">
          <div class="player-card-name">${escHtml(v.char_name || p.name)}</div>
          <div class="player-card-role">${p.is_gm ? '👑 Mestre' : '⚔️ ' + escHtml(p.name)}</div>
        </div>
      </div>
      <div class="player-vitals">
        <div class="vital-row">
          <span class="vital-label" style="color:#e94560">❤️</span>
          <div class="vital-bar-wrap"><div class="vital-bar vida" style="width:${vidaRatio*100}%"></div></div>
          <div class="vital-inputs">
            <input class="vital-input" type="number" value="${v.vida||''}" placeholder="—" ${disabled} onchange="updateVital('${sid}','vida',this.value)">
            <span class="vital-sep">/</span>
            <input class="vital-input" type="number" value="${v.vida_max||''}" placeholder="—" ${disabled} onchange="updateVital('${sid}','vida_max',this.value)">
          </div>
        </div>
        <div class="vital-row">
          <span class="vital-label" style="color:#7ab3ff">🧠</span>
          <div class="vital-bar-wrap"><div class="vital-bar sanidade" style="width:${sanRatio*100}%"></div></div>
          <div class="vital-inputs">
            <input class="vital-input" type="number" value="${v.sanidade||''}" placeholder="—" ${disabled} onchange="updateVital('${sid}','sanidade',this.value)">
            <span class="vital-sep">/</span>
            <input class="vital-input" type="number" value="${v.sanidade_max||''}" placeholder="—" ${disabled} onchange="updateVital('${sid}','sanidade_max',this.value)">
          </div>
        </div>
        <div class="vital-row">
          <span class="vital-label" style="color:#f5c518">⚡</span>
          <div class="vital-bar-wrap"><div class="vital-bar energia" style="width:${enRatio*100}%"></div></div>
          <div class="vital-inputs">
            <input class="vital-input" type="number" value="${v.energia||''}" placeholder="—" ${disabled} onchange="updateVital('${sid}','energia',this.value)">
            <span class="vital-sep">/</span>
            <input class="vital-input" type="number" value="${v.energia_max||''}" placeholder="—" ${disabled} onchange="updateVital('${sid}','energia_max',this.value)">
          </div>
        </div>
      </div>
      ${isGM && !p.is_gm ? `
      <div class="player-card-actions">
        <button class="player-action-btn" onclick="requestPlayerSheet('${sid}')">📋 Ver Ficha</button>
      </div>` : ''}`;
    el.appendChild(card);
  }
}

function updateVital(sid, field, value) {
  if (!players[sid]) return;
  const vitals = { ...(players[sid].vitals || {}) };
  vitals[field] = parseInt(value) || 0;
  players[sid].vitals = vitals;
  socket.emit('update_vitals', { room_id: ROOM_ID, target_sid: sid, vitals });
  renderPlayers();
}

function requestPlayerSheet(sid) {
  socket.emit('request_player_sheet', { room_id: ROOM_ID, target_sid: sid });
}

function openGMSheet(sid, sheet) {
  const p = players[sid] || {};
  document.getElementById('gm-sheet-title').textContent = `📋 Ficha: ${sheet.name || p.name || 'Jogador'}`;
  const content = document.getElementById('gm-sheet-content');

  const cls = ['sentitivo','possuido','feiticeiro','santificado'].filter(c => sheet[`cls-${c}`]).join(', ') || '—';
  const attrs = [
    ['Força', sheet.forca], ['Agilidade', sheet.agilidade], ['Inteligência', sheet.inteligencia],
    ['Mental', sheet.mental], ['Lábia', sheet.labia], ['Furtividade', sheet.furtividade], ['Defesa', sheet.defesa]
  ];
  const pers = [
    ['Investigação', sheet.investigacao], ['Sobrevivência', sheet.sobrevivencia], ['Ocultismo', sheet.ocultismo],
    ['Religião', sheet.religiao], ['Medicina', sheet.medicina], ['Intuição', sheet.intuicao]
  ];

  content.innerHTML = `
    <div class="gm-sheet-section">
      <h4>Dados</h4>
      <div style="font-size:0.85rem;line-height:1.7;color:#ccc">
        <div><b>Classe:</b> ${escHtml(cls)}</div>
        <div><b>Nível:</b> ${escHtml(sheet.nivel||'1')} &nbsp; <b>XP:</b> ${escHtml(sheet.xp||'0')}</div>
        <div><b>Idade:</b> ${escHtml(sheet.age||'—')} &nbsp; <b>Altura:</b> ${escHtml(sheet.height||'—')} &nbsp; <b>Peso:</b> ${escHtml(sheet.weight||'—')}</div>
      </div>
    </div>
    <div class="gm-sheet-section">
      <h4>Recursos</h4>
      <div class="gm-vitals-row">
        <div class="gm-vital-box vida"><div class="label">VIDA</div><div class="value">${sheet.vida||0}/${sheet['vida-max']||60}</div></div>
        <div class="gm-vital-box san"><div class="label">SANIDADE</div><div class="value">${sheet.sanidade||0}/${sheet['sanidade-max']||50}</div></div>
        <div class="gm-vital-box en"><div class="label">ENERGIA</div><div class="value">${sheet.energia||0}/${sheet['energia-max']||50}</div></div>
      </div>
    </div>
    <div class="gm-sheet-section">
      <h4>Atributos</h4>
      <div class="gm-attr-grid">${attrs.map(([n,v]) => `<div class="gm-attr-item"><strong>${n}</strong><span>${v||0}</span></div>`).join('')}</div>
    </div>
    <div class="gm-sheet-section">
      <h4>Perícias</h4>
      <div class="gm-attr-grid">${pers.map(([n,v]) => `<div class="gm-attr-item"><strong>${n}</strong><span>${v||0}</span></div>`).join('')}</div>
    </div>
    ${sheet.personalidade ? `<div class="gm-sheet-section"><h4>Personalidade</h4><p style="font-size:0.82rem;color:#bbb">${escHtml(sheet.personalidade)}</p></div>` : ''}
    ${sheet.historia ? `<div class="gm-sheet-section"><h4>História</h4><p style="font-size:0.82rem;color:#bbb">${escHtml(sheet.historia)}</p></div>` : ''}
    ${sheet.anotacoes ? `<div class="gm-sheet-section"><h4>Anotações</h4><p style="font-size:0.82rem;color:#bbb">${escHtml(sheet.anotacoes)}</p></div>` : ''}
  `;
  document.getElementById('modal-gm-sheet').classList.remove('hidden');
}

// ===================== FICHAS =====================
let sheetData = JSON.parse(localStorage.getItem('rpg_sheet_v2') || '{}');

const SHEET_SIMPLE_FIELDS = [
  'name','age','height','weight','appearance','origin',
  'forca','agilidade','inteligencia','mental','labia','furtividade','defesa',
  'investigacao','sobrevivencia','ocultismo','religiao','medicina','intuicao',
  'vida','vida-max','sanidade','sanidade-max','energia','energia-max',
  'equipamentos','personalidade','nao-pode','mais-ama','mais-odeia','mais-teme',
  'historia','anotacoes','xp','nivel'
];
const SHEET_CLASSES = ['sentitivo','possuido','feiticeiro','santificado'];

function openSheet() {
  // Campos simples
  for (const f of SHEET_SIMPLE_FIELDS) {
    const el = document.getElementById(`sh-${f}`);
    if (el) el.value = sheetData[f] ?? '';
  }
  // Checkboxes de classe
  for (const c of SHEET_CLASSES) {
    const el = document.getElementById(`sh-cls-${c}`);
    if (el) el.checked = !!sheetData[`cls-${c}`];
  }
  // Avatar
  if (sheetData.avatar) {
    const img = document.getElementById('sh-avatar');
    img.src = sheetData.avatar;
    img.style.display = 'block';
    img.style.transformOrigin = '0 0';
    avatarScale = sheetData.avatarScale || 1;
    avatarX = sheetData.avatarX || 0;
    avatarY = sheetData.avatarY || 0;
    applyAvatarTransform();
    document.getElementById('sh-avatar-placeholder').style.display = 'none';
    document.getElementById('sh-avatar-controls').style.display = 'flex';
    document.getElementById('sh-avatar-slot').onclick = null;
  } else {
    document.getElementById('sh-avatar-slot').onclick = () => document.getElementById('sh-img-upload').click();
  }
  initAvatarDrag();
  // Inventário
  renderInventory(sheetData.inventory || []);
  // Habilidades
  renderHabilidades(sheetData.habilidades || []);
  // Máximos (só GM edita)
  const attrMax = document.getElementById('sh-attr-max');
  if (attrMax) attrMax.value = sheetData['attr-max'] ?? 16;
  const perMax = document.getElementById('sh-per-max');
  if (perMax) perMax.value = sheetData['per-max'] ?? 7;

  // Atualiza contadores e hint
  updateAttrPoints(); updateAttrHint();
  updatePerPoints(); updatePerHint();

  // Restrições de GM
  applyGMRestrictions();

  document.getElementById('modal-sheet').classList.remove('hidden');
}

function saveSheet() {
  for (const f of SHEET_SIMPLE_FIELDS) {
    const el = document.getElementById(`sh-${f}`);
    if (el) sheetData[f] = el.value;
  }
  for (const c of SHEET_CLASSES) {
    const el = document.getElementById(`sh-cls-${c}`);
    if (el) sheetData[`cls-${c}`] = el.checked;
  }
  // Inventário
  sheetData.inventory = [];
  document.querySelectorAll('.sheet-inv-input').forEach(el => {
    sheetData.inventory.push(el.value);
  });
  // Habilidades
  sheetData.habilidades = [];
  document.querySelectorAll('.sheet-hab-item').forEach(el => {
    const nome = el.querySelector('input')?.value || '';
    const desc = el.querySelector('textarea')?.value || '';
    sheetData.habilidades.push({ nome, desc });
  });

  sheetData['attr-max'] = parseInt(document.getElementById('sh-attr-max')?.value) || 16;
  sheetData['per-max'] = parseInt(document.getElementById('sh-per-max')?.value) || 7;
  sheetData.avatarScale = avatarScale;
  sheetData.avatarX = avatarX;
  sheetData.avatarY = avatarY;
  localStorage.setItem('rpg_sheet_v2', JSON.stringify(sheetData));

  // Cacheia vitals para uso próprio no card de jogadores
  sheetData._vitals_cache = {
    vida: sheetData.vida, vida_max: sheetData['vida-max'],
    sanidade: sheetData.sanidade, sanidade_max: sheetData['sanidade-max'],
    energia: sheetData.energia, energia_max: sheetData['energia-max'],
    avatar: sheetData.avatar, char_name: sheetData.name
  };
  localStorage.setItem('rpg_sheet_v2', JSON.stringify(sheetData));

  // Atualiza o próprio card imediatamente
  if (players[socket.id]) {
    players[socket.id].vitals = sheetData._vitals_cache;
    players[socket.id].avatar = sheetData.avatar;
    players[socket.id].char_name = sheetData.name;
  }
  renderPlayers();

  // Compartilha vitals + avatar com a sala
  socket.emit('share_sheet', { room_id: ROOM_ID, sheet: sheetData });
  closeModal('modal-sheet');

  // Notifica no chat local
  const msg = { type: 'system', text: `${playerName} salvou a ficha de personagem.`, id: 'local' };
  renderMessage(msg);
}

// Contador de pontos de atributos
function updateAttrPoints() {
  const attrs = ['forca','agilidade','inteligencia','mental','labia','furtividade','defesa'];
  let total = 0;
  for (const a of attrs) {
    const el = document.getElementById(`sh-${a}`);
    if (el) total += parseInt(el.value) || 0;
  }
  const max = parseInt(document.getElementById('sh-attr-max')?.value) || 16;
  const el = document.getElementById('sh-attr-used');
  if (el) {
    el.textContent = total;
    el.style.color = total > max ? '#e94560' : '#d4a060';
  }
}

function updateAttrHint() {
  const max = parseInt(document.getElementById('sh-attr-max')?.value) || 16;
  const el = document.getElementById('sh-attr-hint-text');
  if (el) el.textContent = `${max} pontos para distribuir`;
}

// Contador de pontos de perícias
function updatePerPoints() {
  const pers = ['investigacao','sobrevivencia','ocultismo','religiao','medicina','intuicao'];
  let total = 0;
  for (const p of pers) {
    const el = document.getElementById(`sh-${p}`);
    if (el) total += parseInt(el.value) || 0;
  }
  const max = parseInt(document.getElementById('sh-per-max')?.value) || 7;
  const el = document.getElementById('sh-per-used');
  if (el) {
    el.textContent = total;
    el.style.color = total > max ? '#e94560' : '#d4a060';
  }
}

function updatePerHint() {
  const max = parseInt(document.getElementById('sh-per-max')?.value) || 7;
  const el = document.getElementById('sh-per-hint-text');
  if (el) el.textContent = `${max} pontos para distribuir`;
}

function applyGMRestrictions() {
  document.querySelectorAll('.gm-only').forEach(el => {
    if (!isGM) {
      el.disabled = true;
      el.title = 'Apenas o Mestre pode editar';
    }
  });
}

// Inventário dinâmico
function renderInventory(items) {
  const list = document.getElementById('sh-inventory-list');
  if (!list) return;
  list.innerHTML = '';
  const count = Math.max(10, items.length + 1);
  for (let i = 0; i < count; i++) {
    const row = document.createElement('div');
    row.className = 'sheet-inv-item';
    row.innerHTML = `
      <span class="sheet-inv-num">${i + 1}</span>
      <input class="sheet-inv-input" type="text" value="${escHtml(items[i] || '')}" placeholder="—">
      <button class="sheet-inv-del" onclick="removeInvItem(this)" title="Remover">✕</button>`;
    list.appendChild(row);
  }
}

function removeInvItem(btn) {
  const row = btn.closest('.sheet-inv-item');
  if (document.querySelectorAll('.sheet-inv-item').length > 5) {
    row.remove();
    // Re-numera
    document.querySelectorAll('.sheet-inv-num').forEach((el, i) => { el.textContent = i + 1; });
  } else {
    row.querySelector('.sheet-inv-input').value = '';
  }
}

// Habilidades dinâmicas
function renderHabilidades(habs) {
  const list = document.getElementById('sh-habilidades-list');
  if (!list) return;
  list.innerHTML = '';
  for (const h of habs) addHabilidadeItem(h.nome, h.desc);
  if (habs.length === 0) addHabilidadeItem('', '');
}

function addHabilidade() { addHabilidadeItem('', ''); }

function addHabilidadeItem(nome, desc) {
  const list = document.getElementById('sh-habilidades-list');
  const item = document.createElement('div');
  item.className = 'sheet-hab-item';
  item.innerHTML = `
    <button class="sheet-hab-del" onclick="this.closest('.sheet-hab-item').remove()" title="Remover">✕</button>
    <input type="text" placeholder="Nome da habilidade" value="${escHtml(nome)}">
    <textarea placeholder="Descrição, custo, efeito..." rows="2">${escHtml(desc)}</textarea>`;
  list.appendChild(item);
  item.querySelector('input').focus();
}

// ===================== AVATAR ZOOM/PAN =====================
let avatarScale = 1;
let avatarX = 0;
let avatarY = 0;
let avatarDragging = false;
let avatarDragStartX = 0;
let avatarDragStartY = 0;
let avatarOriginX = 0;
let avatarOriginY = 0;

function applyAvatarTransform() {
  const img = document.getElementById('sh-avatar');
  if (img) img.style.transform = `translate(${avatarX}px, ${avatarY}px) scale(${avatarScale})`;
}

function avatarZoom(delta) {
  avatarScale = Math.max(0.2, Math.min(5, avatarScale + delta));
  applyAvatarTransform();
  sheetData.avatarScale = avatarScale;
  sheetData.avatarX = avatarX;
  sheetData.avatarY = avatarY;
}

function resetAvatar() {
  avatarScale = 1; avatarX = 0; avatarY = 0;
  applyAvatarTransform();
}

function initAvatarDrag() {
  const viewport = document.getElementById('sh-avatar-viewport');
  if (!viewport) return;

  viewport.addEventListener('mousedown', (e) => {
    const img = document.getElementById('sh-avatar');
    if (!img || img.style.display === 'none') return;
    e.preventDefault();
    avatarDragging = true;
    avatarDragStartX = e.clientX;
    avatarDragStartY = e.clientY;
    avatarOriginX = avatarX;
    avatarOriginY = avatarY;
  });

  document.addEventListener('mousemove', (e) => {
    if (!avatarDragging) return;
    avatarX = avatarOriginX + (e.clientX - avatarDragStartX);
    avatarY = avatarOriginY + (e.clientY - avatarDragStartY);
    applyAvatarTransform();
  });

  document.addEventListener('mouseup', () => {
    if (avatarDragging) {
      avatarDragging = false;
      sheetData.avatarX = avatarX;
      sheetData.avatarY = avatarY;
    }
  });

  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    const img = document.getElementById('sh-avatar');
    if (!img || img.style.display === 'none') return;
    avatarZoom(e.deltaY < 0 ? 0.1 : -0.1);
  }, { passive: false });

  // Touch support
  let lastTouchDist = null;
  viewport.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      avatarDragging = true;
      avatarDragStartX = e.touches[0].clientX;
      avatarDragStartY = e.touches[0].clientY;
      avatarOriginX = avatarX;
      avatarOriginY = avatarY;
    } else if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastTouchDist = Math.hypot(dx, dy);
    }
  }, { passive: true });

  viewport.addEventListener('touchmove', (e) => {
    if (e.touches.length === 1 && avatarDragging) {
      avatarX = avatarOriginX + (e.touches[0].clientX - avatarDragStartX);
      avatarY = avatarOriginY + (e.touches[0].clientY - avatarDragStartY);
      applyAvatarTransform();
    } else if (e.touches.length === 2 && lastTouchDist) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      avatarZoom((dist - lastTouchDist) * 0.005);
      lastTouchDist = dist;
    }
  }, { passive: true });

  viewport.addEventListener('touchend', () => { avatarDragging = false; lastTouchDist = null; });
}

// Chama init quando o modal abre
const _origOpenSheet = openSheet;

function loadSheetAvatar(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    sheetData.avatar = e.target.result;
    avatarScale = 1; avatarX = 0; avatarY = 0;
    const img = document.getElementById('sh-avatar');
    img.src = e.target.result;
    img.style.display = 'block';
    img.style.transformOrigin = '0 0';
    applyAvatarTransform();
    document.getElementById('sh-avatar-placeholder').style.display = 'none';
    document.getElementById('sh-avatar-controls').style.display = 'flex';
    // Clique no slot sem imagem vai pro upload; com imagem não faz nada
    document.getElementById('sh-avatar-slot').onclick = null;
  };
  reader.readAsDataURL(file);
}

// ===================== MAPA =====================
function uploadMapBg(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target.result;
    loadBgFromUrl(dataUrl);
    mapState.background = dataUrl;
    socket.emit('map_update', { room_id: ROOM_ID, map: { background: dataUrl } });
  };
  reader.readAsDataURL(file);
}

function loadBgFromUrl(url) {
  const img = new Image();
  img.onload = () => { bgImage = img; redraw(); };
  img.src = url;
}

// ===================== TABS =====================
function switchTab(tab) {
  document.querySelectorAll('.tab').forEach((t, i) => {
    const tabs = ['dice', 'players'];
    t.classList.toggle('active', tabs[i] === tab);
  });
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  const el = document.getElementById(`tab-${tab}`);
  if (el) el.classList.add('active');
}

function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

function copyRoomLink() {
  navigator.clipboard.writeText(window.location.href);
  const btn = document.querySelector('.share-btn');
  const orig = btn.textContent;
  btn.textContent = '✓ Copiado!';
  setTimeout(() => btn.textContent = orig, 2000);
}

function syncGridPanel(map) {
  const sz = document.getElementById('grid-size-slider');
  if (sz && map.grid_size) { sz.value = map.grid_size; document.getElementById('grid-size-val').textContent = map.grid_size + 'px'; }
  const gc = document.getElementById('grid-color');
  if (gc && map.grid_color) gc.value = map.grid_color;
  const go = document.getElementById('grid-opacity');
  if (go && map.grid_opacity !== undefined) { go.value = Math.round(map.grid_opacity * 100); document.getElementById('grid-opacity-val').textContent = Math.round(map.grid_opacity * 100) + '%'; }
  const gv = document.getElementById('grid-visible');
  if (gv && map.show_grid !== undefined) gv.checked = map.show_grid;
  const gs = document.getElementById('grid-snap');
  if (gs && map.snap !== undefined) gs.checked = map.snap;
}

// ===================== GRADE =====================
function toggleGridPanel() {
  document.getElementById('grid-panel').classList.toggle('hidden');
}
function updateGridSize(v) {
  mapState.grid_size = parseInt(v);
  document.getElementById('grid-size-val').textContent = v + 'px';
  socket.emit('map_update', { room_id: ROOM_ID, map: { grid_size: parseInt(v) } });
  redraw();
}
function updateGridColor(v) {
  mapState.grid_color = v;
  socket.emit('map_update', { room_id: ROOM_ID, map: { grid_color: v } });
  redraw();
}
function updateGridOpacity(v) {
  mapState.grid_opacity = parseInt(v) / 100;
  document.getElementById('grid-opacity-val').textContent = v + '%';
  socket.emit('map_update', { room_id: ROOM_ID, map: { grid_opacity: mapState.grid_opacity } });
  redraw();
}
function setGridType(type, btn) {
  mapState.grid_type = type;
  document.querySelectorAll('[id^=grid-type-]').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  socket.emit('map_update', { room_id: ROOM_ID, map: { grid_type: type } });
  redraw();
}
function toggleSnap(v) { mapState.snap = v; }
function setGridVisible(v) {
  mapState.show_grid = v;
  socket.emit('map_update', { room_id: ROOM_ID, map: { show_grid: v } });
  redraw();
}
function clearMapBg() {
  if (!confirm('Limpar imagem de fundo do mapa?')) return;
  bgImage = null;
  mapState.background = null;
  socket.emit('map_update', { room_id: ROOM_ID, map: { background: null } });
  redraw();
}

// ===================== CHAT FLUTUANTE =====================
function toggleFloatingChat() {
  const fc = document.getElementById('floating-chat');
  fc.classList.toggle('hidden');
  if (!fc.classList.contains('hidden')) {
    document.getElementById('fchat-input').focus();
  }
}
function sendFChat() {
  const input = document.getElementById('fchat-input');
  const text = input.value.trim();
  if (!text) return;
  socket.emit('chat_message', { room_id: ROOM_ID, text });
  input.value = '';
}
function fchatKeydown(e) { if (e.key === 'Enter') sendFChat(); }

function renderFChatMessage(msg) {
  const container = document.getElementById('fchat-messages');
  if (!container) return;
  const el = document.createElement('div');
  if (msg.type === 'system') {
    el.className = 'msg msg-system';
    el.textContent = msg.text;
  } else if (msg.type === 'chat') {
    el.className = 'msg msg-chat';
    el.innerHTML = `<span class="author">${escHtml(msg.author)}</span>${escHtml(msg.text)}`;
  } else if (msg.type === 'roll') {
    el.className = 'msg msg-roll';
    const rendered = msg.text.replace(/\*\*(.+?)\*\*/g, '<span class="roll-total">$1</span>');
    el.innerHTML = `<span class="author">${escHtml(msg.author)}</span>${rendered}`;
  } else if (msg.type === 'file') {
    el.className = 'msg msg-chat';
    const isImg = msg.filetype && msg.filetype.startsWith('image/');
    el.innerHTML = `<span class="author">${escHtml(msg.author)}</span>` + (
      isImg
        ? `<br><img class="msg-image" src="${msg.filedata}" alt="${escHtml(msg.filename)}" onclick="window.open(this.src)">`
        : `<br><a class="msg-file-link" href="${msg.filedata}" download="${escHtml(msg.filename)}">📎 ${escHtml(msg.filename)}</a>`
    );
  }
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
}

function sendFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { alert('Arquivo muito grande (máx 5MB)'); return; }
  const reader = new FileReader();
  reader.onload = (e) => {
    socket.emit('file_message', {
      room_id: ROOM_ID,
      filename: file.name,
      filetype: file.type,
      filedata: e.target.result
    });
  };
  reader.readAsDataURL(file);
  event.target.value = '';
}

// ===================== DRAG DE JANELA FLUTUANTE =====================
function startDragWindow(e, id) {
  const win = document.getElementById(id);
  const startX = e.clientX - win.offsetLeft;
  const startY = e.clientY - win.offsetTop;
  win.style.right = 'auto';
  win.style.bottom = 'auto';
  function onMove(e) {
    win.style.left = Math.max(0, e.clientX - startX) + 'px';
    win.style.top  = Math.max(0, e.clientY - startY) + 'px';
  }
  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

// ===================== INIT =====================
document.getElementById('room-id-display').textContent = ROOM_ID;
document.getElementById('player-badge').textContent = (isGM ? '👑 ' : '') + playerName;

// Compartilha ficha salva ao entrar e atualiza próprio card
setTimeout(() => {
  const saved = JSON.parse(localStorage.getItem('rpg_sheet_v2') || '{}');
  if (Object.keys(saved).length > 0) {
    // Atualiza vitals do próprio card
    const vc = saved._vitals_cache || {};
    if (players[socket.id]) {
      players[socket.id].vitals = vc;
      players[socket.id].avatar = saved.avatar;
      players[socket.id].char_name = saved.name;
    }
    renderPlayers();
    socket.emit('share_sheet', { room_id: ROOM_ID, sheet: saved });
  }
}, 1500);
