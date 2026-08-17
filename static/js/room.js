// ===================== INIT =====================
const ROOM_ID = window.ROOM_ID;
const _LS = 'rpg_' + ROOM_ID + '_';

// Valores da sessão atual têm prioridade; fallback para localStorage (persiste ao fechar aba)
const playerName = sessionStorage.getItem('player_name') || localStorage.getItem(_LS + 'name') || 'Jogador';
const isGM = (sessionStorage.getItem('is_gm') || localStorage.getItem(_LS + 'gm') || '') === '1';

// Persiste para reconexão automática
if (playerName !== 'Jogador') localStorage.setItem(_LS + 'name', playerName);
localStorage.setItem(_LS + 'gm', isGM ? '1' : '0');

function getSessionToken() {
  const key = _LS + 'token';
  let t = localStorage.getItem(key);
  if (!t) {
    t = 'tk-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(key, t);
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

  // Conta apenas online para o badge
  const onlineCount = Object.values(players).filter(p => p.online !== false).length;
  const countEl = document.getElementById('mobile-online-count');
  if (countEl) countEl.textContent = onlineCount;

  // Ordena: GM primeiro, depois jogadores em ordem alfabética
  const sorted = Object.entries(players).sort(([, a], [, b]) => {
    if (a.is_gm && !b.is_gm) return -1;
    if (!a.is_gm && b.is_gm) return 1;
    return (a.name || '').localeCompare(b.name || '', 'pt-BR', { sensitivity: 'base' });
  });

  for (const [sid, p] of sorted) {
    const isOnline = p.online !== false;
    const color = playerColor(sid);
    const v = p.vitals || {};
    const vidaPct  = v.vida_max  ? Math.min(100, Math.round((v.vida  || 0) / v.vida_max  * 100)) : 0;
    const sanPct   = v.sanidade_max ? Math.min(100, Math.round((v.sanidade || 0) / v.sanidade_max * 100)) : 0;
    const enPct    = v.energia_max  ? Math.min(100, Math.round((v.energia  || 0) / v.energia_max  * 100)) : 0;
    const avatarHtml = v.avatar
      ? `<img src="${v.avatar}" alt="">`
      : `<span>${(p.name || '?')[0].toUpperCase()}</span>`;
    const gmBadge = p.is_gm ? '<span class="pc-gm-badge">GM</span>' : '';
    const offlineBadge = !isOnline ? '<span class="pc-offline-badge">offline</span>' : '';
    const charName = v.char_name ? `<div class="pc-char">${v.char_name}</div>` : '';
    const vidaMax = v.vida_max || 0;
    const sanMax  = v.sanidade_max || 0;
    const enMax   = v.energia_max || 0;
    const canEditVitals = isOnline && (sid === socket.id || (isGM && !p.is_gm));
    const vitalsHtml = p.is_gm ? '' : `
      <div class="pc-vitals${canEditVitals ? ' pc-vitals-clickable' : ''}"${canEditVitals ? ` onclick="editPlayerVitals('${sid}')" title="Clique para editar os vitais"` : ''}>
        <div class="pc-bar-row"><span class="pc-bar-icon">❤️</span><div class="pc-bar-wrap${vidaMax ? '' : ' empty'}"><div class="pc-bar-fill vida" style="width:${vidaPct}%"></div></div><span class="pc-bar-val">${v.vida||0}/${vidaMax||'—'}</span></div>
        <div class="pc-bar-row"><span class="pc-bar-icon">🧠</span><div class="pc-bar-wrap${sanMax ? '' : ' empty'}"><div class="pc-bar-fill sanidade" style="width:${sanPct}%"></div></div><span class="pc-bar-val">${v.sanidade||0}/${sanMax||'—'}</span></div>
        <div class="pc-bar-row"><span class="pc-bar-icon">⚡</span><div class="pc-bar-wrap${enMax ? '' : ' empty'}"><div class="pc-bar-fill energia" style="width:${enPct}%"></div></div><span class="pc-bar-val">${v.energia||0}/${enMax||'—'}</span></div>
      </div>`;
    const level = p.level || 0;
    const bonusLevel = p.bonus_level || 0;
    const levelHtml = p.is_gm ? '' : `
      <div class="pc-level" onclick="${isOnline ? `openLevelPanel('${sid}')` : ''}" title="Clique para ver os ganhos deste nível" style="${isOnline ? '' : 'cursor:default'}">
        🏆 Nível ${level}${bonusLevel > 0 ? ` <span class="pc-level-bonus">+ Bônus ${bonusLevel}</span>` : ''}
      </div>`;
    const actionsHtml = isGM && !p.is_gm && isOnline ? `
      <div class="pc-actions">
        <button class="pc-action-btn" onclick="requestPlayerSheet('${sid}')">📋 Ficha</button>
        <button class="pc-action-btn" onclick="editPlayerVitals('${sid}')">✏️ Vitais</button>
        <button class="pc-action-btn" onclick="openLevelPanel('${sid}')">🏆 Nível</button>
      </div>` : '';
    const card = document.createElement('div');
    card.className = 'player-card' + (isOnline ? '' : ' player-offline');
    card.dataset.sid = sid;
    card.innerHTML = `
      <div class="pc-header">
        <div class="pc-avatar" style="background:${color}">${avatarHtml}</div>
        <div class="pc-info">
          <div class="pc-name">${p.name}${offlineBadge}</div>
          ${charName}
        </div>
        ${gmBadge}
      </div>
      ${vitalsHtml}
      ${levelHtml}
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
  if (data.notes !== undefined) {
    const ta = document.getElementById('table-notes');
    if (ta) ta.value = data.notes || '';
  }
  if (data.library) {
    library = data.library;
    renderLibraryTree();
  }
  if (data.presets && isGM) renderPresetPanel(data.presets);
});

let _notesDebounce = null;
function updateTableNotes(value) {
  clearTimeout(_notesDebounce);
  _notesDebounce = setTimeout(() => {
    socket.emit('notes_update', { room_id: ROOM_ID, notes: value });
  }, 400);
}
socket.on('notes_updated', (data) => {
  const ta = document.getElementById('table-notes');
  if (ta && document.activeElement !== ta) ta.value = data.notes || '';
});

// ===================== BIBLIOTECA DO SISTEMA =====================
let library = {};
let libOpenFolders = new Set();
let libCurrentPageId = null;
let libPendingDeleteId = null;
let _libRenameDebounce = null, _libContentDebounce = null;

function libTreeChildren() {
  const childrenOf = {};
  for (const item of Object.values(library)) {
    const key = item.parentId || '__root__';
    (childrenOf[key] = childrenOf[key] || []).push(item);
  }
  const sortFn = (a, b) => (a.type === b.type ? a.name.localeCompare(b.name, 'pt-BR') : (a.type === 'folder' ? -1 : 1));
  Object.values(childrenOf).forEach(arr => arr.sort(sortFn));
  return childrenOf;
}

function renderLibraryTree() {
  const root = document.getElementById('library-tree');
  if (!root) return;
  const childrenOf = libTreeChildren();

  function renderNode(item) {
    if (item.type === 'folder') {
      const isOpen = libOpenFolders.has(item.id);
      const kids = childrenOf[item.id] || [];
      const kidsHtml = kids.map(renderNode).join('');
      return `
        <div class="lib-row lib-folder-row" data-id="${item.id}" onclick="libToggleFolder('${item.id}')">
          <span class="lib-toggle">${isOpen ? '▼' : '▶'}</span>
          <span class="lib-icon">📁</span>
          <span class="lib-name" data-id="${item.id}" onclick="event.stopPropagation()" onblur="libSaveName(this)" onkeydown="libNameKeydown(event,this)">${escHtml(item.name)}</span>
          <span class="lib-row-actions gm-only">
            <button onclick="event.stopPropagation();libCreateItem('${item.id}','folder')" title="Nova subpasta">📁+</button>
            <button onclick="event.stopPropagation();libCreateItem('${item.id}','page')" title="Nova página">📄+</button>
            <button onclick="event.stopPropagation();libDeleteItem('${item.id}',this)" title="Excluir pasta e conteúdo">🗑️</button>
          </span>
        </div>
        <div class="lib-children" style="display:${isOpen ? 'block' : 'none'}">${kidsHtml}</div>`;
    }
    return `
      <div class="lib-row lib-page-row${item.id === libCurrentPageId ? ' active' : ''}" data-id="${item.id}" onclick="libOpenPage('${item.id}')">
        <span class="lib-icon">📄</span>
        <span class="lib-name">${escHtml(item.name)}</span>
        <span class="lib-row-actions gm-only">
          <button onclick="event.stopPropagation();libDeleteItem('${item.id}',this)" title="Excluir página">🗑️</button>
        </span>
      </div>`;
  }

  const roots = childrenOf['__root__'] || [];
  root.innerHTML = roots.map(renderNode).join('') || '<div class="lib-empty-hint">Nenhum item ainda.</div>';
  root.querySelectorAll('.lib-name[data-id]').forEach(el => { el.contentEditable = isGM; });
}

function libFilterTree(query) {
  const q = (query || '').trim().toLowerCase();
  const root = document.getElementById('library-tree');
  if (!root) return;
  if (!q) { renderLibraryTree(); return; }
  const matches = Object.values(library).filter(it => it.name.toLowerCase().includes(q) && it.type === 'page');
  root.innerHTML = matches.map(item => `
    <div class="lib-row lib-page-row${item.id === libCurrentPageId ? ' active' : ''}" data-id="${item.id}" onclick="libOpenPage('${item.id}')">
      <span class="lib-icon">📄</span>
      <span class="lib-name">${escHtml(item.name)}</span>
    </div>`).join('') || '<div class="lib-empty-hint">Nada encontrado.</div>';
}

function libToggleFolder(id) {
  if (libOpenFolders.has(id)) libOpenFolders.delete(id); else libOpenFolders.add(id);
  renderLibraryTree();
}

function libCreateItem(parentId, type) {
  if (!isGM) return;
  if (parentId) libOpenFolders.add(parentId);
  socket.emit('library_create', { room_id: ROOM_ID, parentId, type });
}

socket.on('library_item_created', (item) => {
  library[item.id] = item;
  renderLibraryTree();
});

function libSaveName(el) {
  if (!isGM) return;
  const id = el.dataset.id;
  const name = el.textContent.trim() || 'Sem nome';
  el.textContent = name;
  if (library[id] && library[id].name !== name) {
    library[id].name = name;
    socket.emit('library_rename', { room_id: ROOM_ID, id, name });
  }
}
function libNameKeydown(e, el) {
  if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
}

socket.on('library_item_renamed', (data) => {
  if (library[data.id]) library[data.id].name = data.name;
  renderLibraryTree();
  if (libCurrentPageId === data.id) {
    const titleEl = document.getElementById('lib-page-title');
    if (titleEl && document.activeElement !== titleEl) titleEl.textContent = data.name;
  }
});

function libDeleteItem(id, btn) {
  if (!isGM) return;
  if (libPendingDeleteId === id) {
    socket.emit('library_delete', { room_id: ROOM_ID, id });
    libPendingDeleteId = null;
    return;
  }
  libPendingDeleteId = id;
  const orig = btn.textContent, origTitle = btn.title;
  btn.textContent = '⚠️';
  btn.title = 'Clique de novo para confirmar a exclusão';
  setTimeout(() => {
    if (libPendingDeleteId === id) { libPendingDeleteId = null; btn.textContent = orig; btn.title = origTitle; }
  }, 3000);
}

function libDeleteCurrent(btn) {
  if (!isGM || !libCurrentPageId) return;
  libDeleteItem(libCurrentPageId, btn);
}

socket.on('library_item_deleted', (data) => {
  (data.deletedIds || []).forEach(id => delete library[id]);
  if (data.deletedIds?.includes(libCurrentPageId)) {
    libCurrentPageId = null;
    document.getElementById('lib-page-view')?.classList.add('hidden');
    document.getElementById('lib-empty-state')?.classList.remove('hidden');
  }
  renderLibraryTree();
});

function libOpenPage(id) {
  const item = library[id];
  if (!item || item.type !== 'page') return;
  libCurrentPageId = id;
  document.getElementById('lib-empty-state')?.classList.add('hidden');
  document.getElementById('lib-page-view')?.classList.remove('hidden');
  const titleEl = document.getElementById('lib-page-title');
  const contentEl = document.getElementById('lib-page-content');
  if (titleEl) { titleEl.textContent = item.name; titleEl.contentEditable = isGM; }
  if (contentEl) { contentEl.innerHTML = item.content || ''; contentEl.contentEditable = isGM; }
  renderLibraryTree();
}

function libRenameTitle() {
  if (!isGM || !libCurrentPageId) return;
  clearTimeout(_libRenameDebounce);
  const name = document.getElementById('lib-page-title').textContent.trim() || 'Sem título';
  _libRenameDebounce = setTimeout(() => {
    if (library[libCurrentPageId]) library[libCurrentPageId].name = name;
    socket.emit('library_rename', { room_id: ROOM_ID, id: libCurrentPageId, name });
  }, 500);
}

function libUpdateContent() {
  if (!isGM || !libCurrentPageId) return;
  clearTimeout(_libContentDebounce);
  const id = libCurrentPageId;
  const html = document.getElementById('lib-page-content').innerHTML;
  _libContentDebounce = setTimeout(() => {
    if (library[id]) library[id].content = html;
    socket.emit('library_update_content', { room_id: ROOM_ID, id, content: html });
  }, 500);
}

socket.on('library_item_updated', (data) => {
  if (library[data.id]) library[data.id].content = data.content;
  if (libCurrentPageId === data.id) {
    const el = document.getElementById('lib-page-content');
    if (el && document.activeElement !== el) el.innerHTML = data.content || '';
  }
});

let _msgHandler = null;
if (_msgHandler) socket.off('new_message', _msgHandler);
_msgHandler = (msg) => {
  appendMessage(msg);
  if (msg.type === 'roll') {
    if (msg.author === playerName) showDice3D(msg.total, msg.rolls?.[0] || msg.total, msg.author);
    addDiceHistory(msg);
  }
};
socket.on('new_message', _msgHandler);

let _atBottom = true;
let _unreadCount = 0;

function _addMsgActions(row, msg) {
  const myName = playerName;
  const authorName = msg.realAuthor || msg.author;
  const isAuthor = authorName === myName;
  const canDelete = isGM || isAuthor;
  const canEdit = isAuthor && msg.type !== 'roll' && msg.type !== 'system' && msg.type !== 'file';
  const canPin = isGM && msg.type !== 'system';
  if (!canDelete && !canEdit && !canPin) return;

  const actions = document.createElement('div');
  actions.className = 'msg-actions';

  if (canPin) {
    const pinBtn = document.createElement('button');
    pinBtn.className = 'msg-pin-btn';
    pinBtn.textContent = '📌';
    pinBtn.title = 'Repostar como destaque';
    pinBtn.addEventListener('click', () => repostMsg(msg.text, authorName));
    actions.appendChild(pinBtn);
  }
  if (canEdit) {
    const editBtn = document.createElement('button');
    editBtn.className = 'msg-pin-btn';
    editBtn.textContent = '✏️';
    editBtn.title = 'Editar mensagem';
    editBtn.addEventListener('click', () => startEditMsg(msg.id, row));
    actions.appendChild(editBtn);
  }
  if (canDelete) {
    const delBtn = document.createElement('button');
    delBtn.className = 'msg-pin-btn';
    delBtn.textContent = '🗑️';
    delBtn.title = 'Apagar mensagem';
    delBtn.addEventListener('click', () => {
      socket.emit('delete_message', { room_id: ROOM_ID, msg_id: msg.id });
    });
    actions.appendChild(delBtn);
  }
  row.appendChild(actions);
}

function startEditMsg(msgId, row) {
  const bodyEl = row.querySelector('.msg-body');
  if (!bodyEl || row.querySelector('.msg-edit-input')) return;
  const origText = bodyEl.dataset.rawText || bodyEl.textContent;
  const origHTML = bodyEl.innerHTML;

  const inp = document.createElement('input');
  inp.type = 'text';
  inp.value = origText;
  inp.maxLength = 700;
  inp.className = 'msg-edit-input';

  const ok = document.createElement('button');
  ok.textContent = '✓'; ok.className = 'msg-edit-ok';
  const cancel = document.createElement('button');
  cancel.textContent = '✕'; cancel.className = 'msg-edit-cancel';

  const btnRow = document.createElement('div');
  btnRow.className = 'msg-edit-btns';
  btnRow.appendChild(ok);
  btnRow.appendChild(cancel);
  bodyEl.innerHTML = '';
  bodyEl.appendChild(inp);
  bodyEl.appendChild(btnRow);
  inp.focus(); inp.select();

  const doConfirm = () => {
    const newText = inp.value.trim();
    if (!newText) return;
    socket.emit('edit_message', { room_id: ROOM_ID, msg_id: msgId, text: newText });
    bodyEl.innerHTML = origHTML;
  };
  const doCancel = () => { bodyEl.innerHTML = origHTML; };

  ok.addEventListener('click', doConfirm);
  cancel.addEventListener('click', doCancel);
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); doConfirm(); }
    if (e.key === 'Escape') doCancel();
  });
}

function appendMessage(msg) {
  const list = document.getElementById('messages-list');
  if (!list) return;
  if (msg.deleted) {
    const el = document.createElement('div');
    el.className = 'msg-system msg-deleted-ph';
    if (msg.id) el.dataset.msgId = msg.id;
    el.textContent = `🗑️ Mensagem de ${msg.realAuthor || msg.author || '?'} apagada por ${msg.deletedBy || '?'}`;
    list.appendChild(el);
    scrollMessages();
    return;
  }
  if (msg.type === 'whisper') {
    const row = document.createElement('div');
    row.className = 'msg-whisper';
    if (msg.id) row.dataset.msgId = msg.id;
    const safeText = (msg.text || '').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const iAmAuthor = msg.author === playerName;
    const label = iAmAuthor
      ? `🤫 Você sussurra para <strong>${msg.target}</strong>`
      : `🤫 <strong>${msg.author}</strong> sussurra${isGM && !iAmAuthor && msg.target && msg.target.toLowerCase() !== playerName.toLowerCase() ? ` para <strong>${msg.target}</strong>` : ''}`;
    row.innerHTML = `<div class="msg-whisper-label">${label}</div><div class="msg-whisper-text" data-raw-text="${(msg.text||'').replace(/"/g,'&quot;')}">${safeText}</div>`;
    _addMsgActions(row, msg);
    list.appendChild(row);
    scrollMessages();
    return;
  }
  if (msg.type === 'system') {
    const el = document.createElement('div');
    el.className = 'msg-system';
    if (msg.id) el.dataset.msgId = msg.id;
    el.textContent = msg.text;
    list.appendChild(el);
    scrollMessages();
    return;
  }
  if (msg.type === 'highlight') {
    const row = document.createElement('div');
    row.className = 'msg-highlight';
    if (msg.id) row.dataset.msgId = msg.id;
    const safeText = (msg.text || '').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const safeOrig = (msg.origAuthor || '').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const origLine = safeOrig && safeOrig !== msg.author ? `<div class="msg-highlight-orig">originalmente de <strong>${safeOrig}</strong></div>` : '';
    row.innerHTML = `<div class="msg-highlight-label">📌 Destaque por ${msg.author}</div>${origLine}<div class="msg-highlight-text">${safeText}</div>`;
    _addMsgActions(row, msg);
    list.appendChild(row);
    scrollMessages();
    return;
  }
  const row = document.createElement('div');
  if (msg.id) row.dataset.msgId = msg.id;
  const authorColor = getAuthorColor(msg.author);
  const time = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  if (msg.type === 'narrador') {
    row.className = 'msg-narrador';
    const safeText = (msg.text || '').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    row.innerHTML = `<em class="narrador-text msg-body" data-raw-text="${(msg.text||'').replace(/"/g,'&quot;')}">${safeText}</em>`;
    _addMsgActions(row, msg);
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
        <div class="msg-body" style="font-style:italic" data-raw-text="${(msg.text||'').replace(/"/g,'&quot;')}">${safeText}</div>
      </div>`;
  } else if (msg.type === 'file') {
    const isImg = msg.filetype && msg.filetype.startsWith('image/');
    const category = msg.category && REVEAL_META[msg.category] ? msg.category : 'none';
    let bodyHtml;
    if (isImg && category !== 'none' && !revealedImages.has(msg.id)) {
      const meta = REVEAL_META[category];
      bodyHtml = `
        <div class="reveal-card ${meta.cls}" data-msg-id="${msg.id}" onclick="revealImage('${msg.id}', this)">
          <img src="${msg.filedata}" class="reveal-img" alt="${msg.filename}">
          <div class="reveal-cover">${meta.cover}<div class="reveal-label">${meta.label}</div></div>
        </div>`;
    } else if (isImg) {
      bodyHtml = `<img src="${msg.filedata}" class="msg-img" alt="${msg.filename}" onclick="openLightbox(this.src)">`;
    } else {
      bodyHtml = `<a class="msg-file-link" href="${msg.filedata}" download="${msg.filename}">📎 ${msg.filename}</a>`;
    }
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
        <div class="msg-body" data-raw-text="${(msg.text||'').replace(/"/g,'&quot;')}">${safeText}</div>
      </div>`;
  }
  _addMsgActions(row, msg);
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

function localSystemMessage(text) {
  const list = document.getElementById('messages-list');
  if (!list) return;
  const el = document.createElement('div');
  el.className = 'msg-system';
  el.textContent = text;
  list.appendChild(el);
  scrollMessages();
}

const TABLE_LOCATION = 'Cidade das Flores';

function sendChat() {
  const input = document.getElementById('chat-input');
  const text = (input.value || '').trim();
  if (!text) return;

  // Comandos /rollDX (qualquer número de faces, ex: /rollD6, /rollD12, /rollD20, /rollD6 3)
  const diceMatch = text.match(/^\/roll[Dd](\d+)(?:\s+(\d+))?$/);
  if (diceMatch) {
    const sides = parseInt(diceMatch[1]);
    const count = parseInt(diceMatch[2]) || 1;
    if (sides > 0 && sides <= 1000) rollDice(sides, count, 0);
    input.value = '';
    return;
  }

  // Comando /w Nome mensagem — sussurro visível só pro destinatário e o GM
  const whisperMatch = text.match(/^\/w(?:hisper)?\s+(\S+)\s+([\s\S]+)$/i);
  if (whisperMatch) {
    socket.emit('chat_message', { room_id: ROOM_ID, text: whisperMatch[2], chat_type: 'whisper', target: whisperMatch[1] });
    input.value = '';
    return;
  }

  // /segredo — jogador manda direto pro GM sem precisar saber o nome; GM manda pra um jogador específico
  const segredoMatch = text.match(/^\/segredo\s+([\s\S]+)$/i);
  if (segredoMatch) {
    const rest = segredoMatch[1];
    if (isGM) {
      const gmTargetMatch = rest.match(/^(\S+)\s+([\s\S]+)$/);
      const targetPlayer = gmTargetMatch && Object.values(players).find(p => p.name.toLowerCase() === gmTargetMatch[1].toLowerCase());
      if (targetPlayer) {
        socket.emit('chat_message', { room_id: ROOM_ID, text: gmTargetMatch[2], chat_type: 'whisper', target: targetPlayer.name });
      } else {
        localSystemMessage('Uso: /segredo NomeDoJogador mensagem');
      }
    } else {
      const gmPlayer = Object.values(players).find(p => p.is_gm);
      if (gmPlayer) {
        socket.emit('chat_message', { room_id: ROOM_ID, text: rest, chat_type: 'whisper', target: gmPlayer.name });
      } else {
        localSystemMessage('Nenhum mestre está na sala agora.');
      }
    }
    input.value = '';
    return;
  }

  // /desc texto — narração rápida, sem precisar trocar o modo do chat
  const descMatch = text.match(/^\/desc\s+([\s\S]+)$/i);
  if (descMatch) {
    socket.emit('chat_message', { room_id: ROOM_ID, text: descMatch[1], chat_type: 'narrador' });
    input.value = '';
    return;
  }

  // /fix texto — fixa a mensagem como destaque na mesa (só GM)
  const fixMatch = text.match(/^\/fix\s+([\s\S]+)$/i);
  if (fixMatch) {
    if (!isGM) { localSystemMessage('Somente o mestre pode fixar mensagens.'); input.value = ''; return; }
    socket.emit('chat_message', { room_id: ROOM_ID, text: fixMatch[1], chat_type: 'highlight' });
    input.value = '';
    return;
  }

  // /time 14:30 ou /time>14:30 — marca o horário da história na mesa (só GM)
  const timeMatch = text.match(/^\/time(?:\s+|>)(\d{1,2}):(\d{2})$/i);
  if (timeMatch) {
    if (!isGM) { localSystemMessage('Somente o mestre pode ajustar o horário da mesa.'); input.value = ''; return; }
    const hh = parseInt(timeMatch[1]), mm = parseInt(timeMatch[2]);
    if (hh > 23 || mm > 59) { localSystemMessage('Horário inválido. Use, por exemplo: /time 14:30'); input.value = ''; return; }
    const hhStr = String(hh).padStart(2, '0'), mmStr = String(mm).padStart(2, '0');
    socket.emit('chat_message', { room_id: ROOM_ID, text: `São ${hhStr}:${mmStr} na ${TABLE_LOCATION}.`, chat_type: 'narrador' });
    input.value = '';
    return;
  }

  // /clear — limpa o chat da mesa pra todo mundo (só GM)
  if (/^\/clear$/i.test(text)) {
    if (!isGM) { localSystemMessage('Somente o mestre pode limpar o chat.'); input.value = ''; return; }
    socket.emit('clear_chat', { room_id: ROOM_ID });
    input.value = '';
    return;
  }

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

socket.on('chat_cleared', () => {
  const list = document.getElementById('messages-list');
  if (list) list.innerHTML = '';
});

socket.on('message_deleted', (data) => {
  const el = document.querySelector(`[data-msg-id="${data.msg_id}"]`);
  if (!el) return;
  el.className = 'msg-system msg-deleted-ph';
  el.textContent = `🗑️ Mensagem apagada por ${data.deletedBy || '?'}`;
});

socket.on('message_edited', (data) => {
  const el = document.querySelector(`[data-msg-id="${data.msg_id}"]`);
  if (!el) return;
  const body = el.querySelector('.msg-body, .msg-whisper-text');
  if (!body) return;
  const safeText = (data.text || '').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const wasItalic = body.style.fontStyle === 'italic';
  body.dataset.rawText = data.text;
  body.innerHTML = safeText + ` <span class="msg-edited" title="Editado ${data.editCount || 1}x">(editado)</span>`;
  if (wasItalic) body.style.fontStyle = 'italic';
});

function chatKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
}

let currentImgCategory = 'none';

function setImgCategory(cat, btn) {
  currentImgCategory = cat;
  document.querySelectorAll('.img-cat-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

function sendFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  const isImg = file.type && file.type.startsWith('image/');
  const category = isImg ? currentImgCategory : 'none';
  const reader = new FileReader();
  reader.onload = (e) => {
    socket.emit('file_message', {
      room_id: ROOM_ID, filename: file.name,
      filetype: file.type, filedata: e.target.result, category
    });
  };
  reader.readAsDataURL(file);
  event.target.value = '';
  if (isImg && currentImgCategory !== 'none') {
    setImgCategory('none', document.querySelector('.img-cat-btn[data-cat="none"]'));
  }
}

function leaveRoom() {
  if (!confirm('Tem certeza que quer sair da mesa? Você será removido da lista de jogadores.')) return;
  // Limpa dados persistentes desta sala para entrar de novo como uma pessoa nova
  localStorage.removeItem(_LS + 'token');
  localStorage.removeItem(_LS + 'name');
  localStorage.removeItem(_LS + 'gm');
  socket.emit('leave_room');
  setTimeout(() => { window.location.href = '/'; }, 300);
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

// ===================== IMAGENS: REVELAÇÃO E LIGHTBOX =====================
const revealedImages = new Set();
const REVEAL_META = {
  enemy: { cls: 'reveal-enemy', label: 'Clique para revelar', cover: '<div class="reveal-icon">🍂</div>' },
  clue:  { cls: 'reveal-clue',  label: 'Clique para abrir o envelope', cover: '<div class="reveal-icon">🗂️</div>' },
  npc:   { cls: 'reveal-npc',   label: 'Clique para revelar', cover: '<div class="reveal-icon reveal-icon-bud">🌱</div><div class="reveal-icon reveal-icon-bloom">🌸</div>' }
};

function revealImage(msgId, cardEl) {
  if (cardEl.classList.contains('revealed')) {
    const img = cardEl.querySelector('.reveal-img');
    if (img) openLightbox(img.src);
    return;
  }
  if (cardEl.classList.contains('revealing')) return;
  cardEl.classList.add('revealing');
  revealedImages.add(msgId);
  setTimeout(() => cardEl.classList.add('revealed'), 1100);
}

function openLightbox(src) {
  const overlay = document.getElementById('img-lightbox');
  const img = document.getElementById('img-lightbox-img');
  if (!overlay || !img) return;
  img.src = src;
  overlay.classList.remove('hidden');
}

function closeLightbox() {
  const overlay = document.getElementById('img-lightbox');
  if (overlay) overlay.classList.add('hidden');
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeLightbox();
});

// ===================== DICE =====================
let _diceOverlayTimer = null;

function rollAttr(label, inputId) {
  const el = document.getElementById(inputId);
  const value = parseInt(el?.value) || 0;
  socket.emit('attr_roll', { room_id: ROOM_ID, label, value });
}

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
let _touchPinchDist = 0, _touchPinchMidX = 0, _touchPinchMidY = 0;
let currentTool = 'select';
let tokens = {};
let pins = {};
let selectedTokenIds = new Set();
let draggingToken = null, dragOffX = 0, dragOffY = 0;
let isRubberBand = false, rubberStart = null, rubberEnd = null;
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
  mapCanvas.addEventListener('touchstart', onMapTouchStart, { passive: false });
  mapCanvas.addEventListener('touchmove', onMapTouchMove, { passive: false });
  mapCanvas.addEventListener('touchend', onMapTouchEnd, { passive: false });
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
  if (isRubberBand && rubberStart && rubberEnd) drawRubberBand();
}

function drawRubberBand() {
  const x1 = rubberStart.x * mapZoom + mapOffset.x;
  const y1 = rubberStart.y * mapZoom + mapOffset.y;
  const x2 = rubberEnd.x * mapZoom + mapOffset.x;
  const y2 = rubberEnd.y * mapZoom + mapOffset.y;
  mapCtx.save();
  mapCtx.strokeStyle = '#7c6af7';
  mapCtx.fillStyle = 'rgba(124,106,247,0.12)';
  mapCtx.lineWidth = 1.5;
  mapCtx.setLineDash([5, 3]);
  mapCtx.fillRect(Math.min(x1,x2), Math.min(y1,y2), Math.abs(x2-x1), Math.abs(y2-y1));
  mapCtx.strokeRect(Math.min(x1,x2), Math.min(y1,y2), Math.abs(x2-x1), Math.abs(y2-y1));
  mapCtx.restore();
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
  if (tok.hidden) mapCtx.globalAlpha = 0.4;
  mapCtx.beginPath();
  mapCtx.arc(sx, sy, sr, 0, Math.PI * 2);
  mapCtx.fillStyle = tok.color || '#7c6af7';
  mapCtx.fill();
  if (selectedTokenIds.has(tok.id)) {
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
  if (pin.hidden) mapCtx.globalAlpha = 0.4;
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
  const rect = mapCanvas.getBoundingClientRect();
  const mp = screenToMap(e.clientX - rect.left, e.clientY - rect.top);
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
    // Se já está selecionado, arrasta todo o grupo; senão seleciona só ele
    if (!selectedTokenIds.has(tok.id)) {
      selectedTokenIds.clear();
      selectedTokenIds.add(tok.id);
    }
    draggingToken = tok; dragOffX = mp.x - tok.x; dragOffY = mp.y - tok.y;
    drawMap(); return;
  }
  // Clicou em espaço vazio — inicia rubber-band
  selectedTokenIds.clear();
  isRubberBand = true;
  rubberStart = { ...mp }; rubberEnd = { ...mp };
  drawMap();
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
    const dx = snapped.x - draggingToken.x;
    const dy = snapped.y - draggingToken.y;
    if (dx !== 0 || dy !== 0) {
      for (const id of selectedTokenIds) {
        if (tokens[id]) { tokens[id].x += dx; tokens[id].y += dy; }
      }
      draggingToken = tokens[draggingToken.id];
    }
    drawMap(); return;
  }
  if (isRubberBand && rubberStart) {
    rubberEnd = screenToMap(mx, my); drawMap(); return;
  }
  if (currentTool === 'measure' && measureStart) {
    measureEnd = screenToMap(mx, my); drawMap();
  }
  const zl = document.getElementById('zoom-info');
  if (zl) zl.textContent = Math.round(mapZoom * 100) + '%';
}

function onMapMouseUp(e) {
  if (draggingToken) {
    for (const id of selectedTokenIds) {
      if (tokens[id]) socket.emit('token_move', { room_id: ROOM_ID, token_id: id, x: tokens[id].x, y: tokens[id].y });
    }
    draggingToken = null;
  }
  if (isRubberBand && rubberStart && rubberEnd) {
    const minX = Math.min(rubberStart.x, rubberEnd.x), maxX = Math.max(rubberStart.x, rubberEnd.x);
    const minY = Math.min(rubberStart.y, rubberEnd.y), maxY = Math.max(rubberStart.y, rubberEnd.y);
    for (const tok of Object.values(tokens)) {
      if (tok.x >= minX && tok.x <= maxX && tok.y >= minY && tok.y <= maxY) selectedTokenIds.add(tok.id);
    }
    isRubberBand = false; rubberStart = null; rubberEnd = null;
    drawMap();
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

function _touchDist(t1, t2) {
  const dx = t1.clientX - t2.clientX, dy = t1.clientY - t2.clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

function onMapTouchStart(e) {
  e.preventDefault();
  hideContextMenu();
  if (e.touches.length === 2) {
    const t1 = e.touches[0], t2 = e.touches[1];
    _touchPinchDist = _touchDist(t1, t2);
    _touchPinchMidX = (t1.clientX + t2.clientX) / 2;
    _touchPinchMidY = (t1.clientY + t2.clientY) / 2;
    isPanning = false; draggingToken = null;
    return;
  }
  if (e.touches.length === 1) {
    const t = e.touches[0];
    const rect = mapCanvas.getBoundingClientRect();
    const mp = screenToMap(t.clientX - rect.left, t.clientY - rect.top);
    const tok = getTokenAt(mp.x, mp.y);
    if (tok) {
      if (!selectedTokenIds.has(tok.id)) { selectedTokenIds.clear(); selectedTokenIds.add(tok.id); }
      draggingToken = tok; dragOffX = mp.x - tok.x; dragOffY = mp.y - tok.y;
      drawMap();
    } else {
      isPanning = true; panStart = { x: t.clientX - mapOffset.x, y: t.clientY - mapOffset.y };
    }
  }
}

function onMapTouchMove(e) {
  e.preventDefault();
  if (e.touches.length === 2) {
    const t1 = e.touches[0], t2 = e.touches[1];
    const newDist = _touchDist(t1, t2);
    const midX = (t1.clientX + t2.clientX) / 2;
    const midY = (t1.clientY + t2.clientY) / 2;
    const rect = mapCanvas.getBoundingClientRect();
    const mx = midX - rect.left, my = midY - rect.top;
    if (_touchPinchDist > 0) {
      const scale = newDist / _touchPinchDist;
      const newZoom = Math.min(4, Math.max(0.1, mapZoom * scale));
      mapOffset.x = mx - (mx - mapOffset.x) * (newZoom / mapZoom);
      mapOffset.y = my - (my - mapOffset.y) * (newZoom / mapZoom);
      mapZoom = newZoom;
      const zl = document.getElementById('zoom-info');
      if (zl) zl.textContent = Math.round(mapZoom * 100) + '%';
    }
    // pan with mid-point delta
    mapOffset.x += midX - _touchPinchMidX;
    mapOffset.y += midY - _touchPinchMidY;
    _touchPinchDist = newDist;
    _touchPinchMidX = midX; _touchPinchMidY = midY;
    drawMap(); return;
  }
  if (e.touches.length === 1) {
    const t = e.touches[0];
    if (isPanning) {
      mapOffset.x = t.clientX - panStart.x; mapOffset.y = t.clientY - panStart.y;
      drawMap(); return;
    }
    if (draggingToken) {
      const rect = mapCanvas.getBoundingClientRect();
      const mp = screenToMap(t.clientX - rect.left, t.clientY - rect.top);
      const snapped = snapToGridPos(mp.x - dragOffX, mp.y - dragOffY);
      const dx = snapped.x - draggingToken.x, dy = snapped.y - draggingToken.y;
      if (dx !== 0 || dy !== 0) {
        for (const id of selectedTokenIds) {
          if (tokens[id]) { tokens[id].x += dx; tokens[id].y += dy; }
        }
        draggingToken = tokens[draggingToken.id];
      }
      drawMap();
    }
  }
}

function onMapTouchEnd(e) {
  e.preventDefault();
  if (e.touches.length < 2) _touchPinchDist = 0;
  if (e.touches.length === 0) {
    if (draggingToken) {
      for (const id of selectedTokenIds) {
        if (tokens[id]) socket.emit('token_move', { room_id: ROOM_ID, token_id: id, x: tokens[id].x, y: tokens[id].y });
      }
      draggingToken = null;
    }
    isPanning = false;
    mapCanvas.style.cursor = currentTool === 'move' ? 'grab' : 'crosshair';
  }
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
  } else if (action === 'hidden') {
    contextMenuToken.hidden = !contextMenuToken.hidden;
    socket.emit('token_update', { room_id: ROOM_ID, token: { ...contextMenuToken } });
    drawMap();
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
  } else if (action === 'hidden') {
    contextMenuPin.hidden = !contextMenuPin.hidden;
    socket.emit('pin_update', { room_id: ROOM_ID, pin: { ...contextMenuPin } });
    drawMap();
  }
  hideContextMenu();
  contextMenuPin = null;
}

socket.on('pin_added', (pin) => { pins[pin.id] = pin; drawMap(); });
socket.on('pin_removed', (d) => { delete pins[d.pin_id]; if (mapInited) drawMap(); });
socket.on('pin_updated', (pin) => { pins[pin.id] = { ...(pins[pin.id] || {}), ...pin }; if (mapInited) drawMap(); });

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

// ===================== PRESETS DE MAPA =====================
let _mapPresets = [];

function togglePresetsPanel() {
  const p = document.getElementById('presets-panel');
  p.classList.toggle('hidden');
}

function saveCurrentPreset() {
  const name = prompt('Nome deste mapa:', 'Novo Mapa');
  if (name === null) return;
  socket.emit('save_preset', { room_id: ROOM_ID, name: name.trim() || 'Mapa sem nome' });
}

function loadPreset(id) {
  if (!confirm('Carregar este mapa? O mapa atual será substituído.')) return;
  socket.emit('load_preset', { room_id: ROOM_ID, preset_id: id });
}

function deletePreset(id) {
  if (!confirm('Excluir este mapa salvo?')) return;
  socket.emit('delete_preset', { room_id: ROOM_ID, preset_id: id });
}

function startRenamePreset(id, currentName) {
  const item = document.querySelector(`.preset-item[data-id="${id}"]`);
  if (!item) return;
  const nameEl = item.querySelector('.preset-name');
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'preset-name-input';
  input.value = currentName;
  nameEl.replaceWith(input);
  input.focus(); input.select();
  const save = () => {
    const newName = input.value.trim() || currentName;
    socket.emit('rename_preset', { room_id: ROOM_ID, preset_id: id, name: newName });
  };
  input.addEventListener('blur', save);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
}

function renderPresetPanel(list) {
  _mapPresets = list || [];
  const el = document.getElementById('presets-list');
  if (!el) return;
  if (!_mapPresets.length) {
    el.innerHTML = '<div class="presets-empty">Nenhum mapa salvo ainda.</div>';
    return;
  }
  el.innerHTML = _mapPresets.map(p => `
    <div class="preset-item" data-id="${p.id}">
      <span class="preset-name">${escHtml(p.name)}</span>
      <div class="preset-actions">
        <button class="preset-btn" onclick="loadPreset('${p.id}')" title="Carregar mapa">→</button>
        <button class="preset-btn" onclick="startRenamePreset('${p.id}','${escHtml(p.name).replace(/'/g,'&#39;')}')" title="Renomear">✏</button>
        <button class="preset-btn danger" onclick="deletePreset('${p.id}')" title="Excluir">🗑</button>
      </div>
    </div>`).join('');
}

socket.on('presets_updated', d => { if (isGM) renderPresetPanel(d.presets); });

socket.on('preset_loaded', d => {
  applyMapState(d.map);
  tokens = {};
  for (const tok of Object.values(d.tokens || {})) spawnToken(tok);
  pins = {};
  for (const pin of Object.values(d.pins || {})) pins[pin.id] = pin;
  drawMap();
  // Sincroniza controles do painel de grade
  if (isGM) {
    const ms = d.map;
    const sl = document.getElementById('grid-size-slider');
    const sv = document.getElementById('grid-size-val');
    const go = document.getElementById('grid-opacity');
    const gov = document.getElementById('grid-opacity-val');
    const gv = document.getElementById('grid-visible');
    if (sl) sl.value = ms.grid_size || 50;
    if (sv) sv.textContent = (ms.grid_size || 50) + 'px';
    if (go) { const op = Math.round((ms.grid_opacity ?? 0.15) * 100); go.value = op; if (gov) gov.textContent = op + '%'; }
    if (gv) gv.checked = ms.show_grid !== false;
  }
});
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

function switchGMTab(name, btn) {
  document.querySelectorAll('#gm-sheet-tabs .sheet-tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('#gm-sheet-body .gm-stab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const tab = document.getElementById('gms-' + name);
  if (tab) tab.classList.add('active');
}

function _gmRO(val, cls = 'sheet-input') {
  const v = (val ?? '').toString();
  return `<input type="text" class="${cls}" value="${v.replace(/"/g,'&quot;')}" readonly>`;
}
function _gmNum(val, cls = 'sheet-attr-input') {
  return `<input type="number" class="${cls}" value="${val ?? 0}" readonly>`;
}
function _gmTA(val, cls = 'sheet-input sheet-textarea', rows = 3) {
  const v = (val ?? '').toString().replace(/</g,'&lt;').replace(/>/g,'&gt;');
  return `<textarea class="${cls}" rows="${rows}" readonly>${v}</textarea>`;
}

socket.on('player_sheet_data', (data) => {
  const p = players[data.sid] || players['off_' + Object.keys(players).find(k => players[k]?.name === data.playerName)];
  const playerName = p?.name || data.playerName || 'Jogador';

  applySheet(data.sheet || {});

  // Nível é uma div (não input), atualiza manualmente
  const nivelEl = document.getElementById('sh-nivel-display');
  if (nivelEl) {
    const lvl = p?.level || 0;
    const bonus = p?.bonus_level || 0;
    nivelEl.textContent = bonus > 0 ? `${lvl} +B${bonus}` : String(lvl);
  }

  switchSheetTab('perfil', document.querySelector('.sheet-tab[data-tab="perfil"]'));

  const modal = document.getElementById('modal-sheet');
  const titleEl = document.getElementById('sheet-main-title');
  const banner = document.getElementById('sheet-gm-banner');
  if (titleEl) titleEl.textContent = `FICHA DE ${playerName.toUpperCase()}`;
  if (banner) { banner.textContent = `👁 VISUALIZANDO — MODO LEITURA`; banner.style.display = 'block'; }
  modal.classList.add('sheet-gm-view');
  modal._gmViewSid = data.sid;
  modal.classList.remove('hidden');

  // CÓDIGO ANTIGO (mantido como fallback, não será executado)
  if (false) {
  const _modal = document.getElementById('modal-gm-sheet');
  const title = document.getElementById('gm-sheet-title');
  const body  = document.getElementById('gm-sheet-body');
  title.textContent = playerName.toUpperCase();
  const s = data.sheet || {};

  // Classes
  const clsBox = document.getElementById('gm-sheet-classes');
  if (clsBox) {
    const cls = s.classes || {};
    clsBox.innerHTML = `<div class="sheet-section-label">CLASSE</div>
      ${['sentitivo','possuido','feiticeiro','santificado'].map(k =>
        `<label class="sheet-check"><input type="checkbox" ${cls[k]?'checked':''} disabled> ${k[0].toUpperCase()+k.slice(1)}</label>`
      ).join('')}`;
  }

  // Inventário
  const invHTML = (s.inventory || []).filter(Boolean).map(item =>
    `<div class="inv-item"><input type="text" value="${(item||'').replace(/"/g,'&quot;')}" class="sheet-input" readonly></div>`
  ).join('') || '<div style="color:var(--text-faint);font-size:12px;padding:4px">Sem itens</div>';

  // Habilidades
  const habHTML = (s.habilidades || []).map(h => `
    <div class="hab-item">
      <div class="hab-header"><input type="text" class="hab-name" value="${(h.name||'').replace(/"/g,'&quot;')}" readonly></div>
      <div class="hab-sub-label">PASSIVA</div>
      <textarea class="hab-passiva" readonly>${escHtml(h.passiva||h.desc||'')}</textarea>
      <div class="hab-sub-label">CENTRAL</div>
      <textarea class="hab-central" readonly>${escHtml(h.central||'')}</textarea>
      <div class="hab-gasto-row"><span class="hab-sub-label" style="margin:0;min-width:44px">GASTO</span>
      <input type="text" class="hab-cost" value="${(h.cost||'').replace(/"/g,'&quot;')}" readonly></div>
    </div>`).join('') || '<div style="color:var(--text-faint);font-size:12px;padding:4px">Sem habilidades</div>';

  body.innerHTML = `
    <style>
      .gm-stab { display:none }
      .gm-stab.active { display:block }
      .gm-stab .sheet-input[readonly], .gm-stab textarea[readonly],
      .gm-stab .sheet-attr-input[readonly], .gm-stab .sheet-recurso-input[readonly],
      .gm-stab .hab-name[readonly], .gm-stab .hab-passiva[readonly],
      .gm-stab .hab-central[readonly], .gm-stab .hab-cost[readonly],
      .gm-stab .inv-item input[readonly] {
        opacity:0.85; cursor:default; pointer-events:none;
      }
    </style>

    <!-- PERFIL -->
    <div class="gm-stab active" id="gms-perfil">
      <div class="stab-inner">
        <div class="sheet-block">
          <div class="sheet-block-title">DADOS DO PERSONAGEM</div>
          <div class="sheet-avatar-row">
            <div class="sheet-avatar-slot" style="pointer-events:none">
              <div class="sheet-avatar-viewport">
                ${s.avatar ? `<img src="${s.avatar}" style="width:100%;height:100%;object-fit:cover;display:block">` : '<span style="color:var(--text-faint);font-size:11px">SEM FOTO</span>'}
              </div>
            </div>
            <div class="sheet-dados-fields">
              <div class="sheet-field-row"><label>NOME</label>${_gmRO(s.name,'sheet-input sheet-input-full')}</div>
              <div class="sheet-field-trio">
                <div class="sheet-field-item"><label>NÍVEL</label>${_gmRO(s.nivel,'sheet-input')}</div>
                <div class="sheet-field-item"><label>XP</label>${_gmRO(s.xp,'sheet-input')}</div>
                <div class="sheet-field-item"><label>IDADE</label>${_gmRO(s.age,'sheet-input')}</div>
              </div>
              <div class="sheet-field-trio">
                <div class="sheet-field-item"><label>ALTURA</label>${_gmRO(s.height,'sheet-input')}</div>
                <div class="sheet-field-item"><label>PESO</label>${_gmRO(s.weight,'sheet-input')}</div>
                <div class="sheet-field-item"><label>PROFISSÃO</label>${_gmRO(s.profissao,'sheet-input')}</div>
              </div>
              <div class="sheet-field-row"><label>APARÊNCIA</label>${_gmRO(s.appearance,'sheet-input sheet-input-full')}</div>
            </div>
          </div>
        </div>
        <div class="sheet-block">
          <div class="sheet-block-title">RECURSOS</div>
          <div class="sheet-recursos">
            <div class="sheet-recurso vida">
              <div class="sheet-recurso-label">VIDA</div>
              <div class="sheet-recurso-icon">❤️</div>
              <div class="sheet-recurso-fields">${_gmNum(s.vida,'sheet-recurso-input')}<span>/</span>${_gmNum(s['vida-max'],'sheet-recurso-input')}</div>
            </div>
            <div class="sheet-recurso mental-r">
              <div class="sheet-recurso-label">MENTAL</div>
              <div class="sheet-recurso-icon">🧠</div>
              <div class="sheet-recurso-fields">${_gmNum(s.sanidade,'sheet-recurso-input')}<span>/</span>${_gmNum(s['sanidade-max'],'sheet-recurso-input')}</div>
            </div>
            <div class="sheet-recurso energia">
              <div class="sheet-recurso-label">ENERGIA</div>
              <div class="sheet-recurso-icon">⚡</div>
              <div class="sheet-recurso-fields">${_gmNum(s.energia,'sheet-recurso-input')}<span>/</span>${_gmNum(s['energia-max'],'sheet-recurso-input')}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- STATUS -->
    <div class="gm-stab" id="gms-status">
      <div class="stab-inner">
        <div class="stab-status-cols">
          <div class="sheet-block">
            <div class="sheet-block-title">ATRIBUTOS</div>
            <div class="sheet-attrs">
              ${[['👊','FORÇA','forca'],['🏃','AGILIDADE','agilidade'],['🛡️','DEFESA','defesa'],
                 ['🧠','INTELIGÊNCIA','inteligencia'],['🧿','MENTAL','mental'],
                 ['💬','LÁBIA','labia'],['🌑','FURTIVIDADE','furtividade']].map(([icon,label,key]) =>
                `<div class="sheet-attr-row"><span class="sheet-attr-icon">${icon}</span>
                 <div class="sheet-attr-info"><strong>${label}</strong></div>
                 ${_gmNum(s[key],'sheet-attr-input')}</div>`).join('')}
            </div>
          </div>
          <div class="sheet-block">
            <div class="sheet-block-title">PERÍCIAS</div>
            <div class="sheet-attrs">
              ${[['🔍','INVESTIGAÇÃO','investigacao'],['🎒','SOBREVIVÊNCIA','sobrevivencia'],
                 ['🔮','OCULTISMO','ocultismo'],['✝️','RELIGIÃO','religiao'],
                 ['👁️','INTUIÇÃO','intuicao'],['🩺','MEDICINA','medicina']].map(([icon,label,key]) =>
                `<div class="sheet-attr-row"><span class="sheet-attr-icon">${icon}</span>
                 <div class="sheet-attr-info"><strong>${label}</strong></div>
                 ${_gmNum(s[key],'sheet-attr-input')}</div>`).join('')}
            </div>
          </div>
        </div>
        <div class="sheet-block">
          <div class="sheet-block-title">EQUIPAMENTOS</div>
          ${_gmTA(s.equipamentos,'sheet-input sheet-textarea',3)}
        </div>
      </div>
    </div>

    <!-- INVENTÁRIO -->
    <div class="gm-stab" id="gms-inventario">
      <div class="stab-inner">
        <div class="sheet-block">
          <div class="sheet-block-title">INVENTÁRIO</div>
          <div class="sheet-inventory">${invHTML}</div>
        </div>
      </div>
    </div>

    <!-- HABILIDADES -->
    <div class="gm-stab" id="gms-habilidades">
      <div class="stab-inner">
        <div class="sheet-block">
          <div class="sheet-block-title">HABILIDADES</div>
          <div class="sheet-hab-list">${habHTML}</div>
        </div>
      </div>
    </div>

    <!-- HISTÓRIA -->
    <div class="gm-stab" id="gms-historia">
      <div class="stab-inner">
        <div class="sheet-block">
          <div class="sheet-block-title">PERSONALIDADE</div>
          ${_gmTA(s.personalidade,'sheet-input sheet-textarea',3)}
          <div class="sheet-curio-title">CURIOSIDADES</div>
          <div class="sheet-curio-row"><label>Não pode fazer</label>${_gmRO(s['nao-pode'],'sheet-input sheet-input-full')}</div>
          <div class="sheet-curio-row"><label>Mais Ama</label>${_gmRO(s['mais-ama'],'sheet-input sheet-input-full')}</div>
          <div class="sheet-curio-row"><label>Mais Odeia</label>${_gmRO(s['mais-odeia'],'sheet-input sheet-input-full')}</div>
          <div class="sheet-curio-row"><label>Mais Teme</label>${_gmRO(s['mais-teme'],'sheet-input sheet-input-full')}</div>
        </div>
        <div class="sheet-block">
          <div class="sheet-block-title">HISTÓRIA DO PERSONAGEM</div>
          ${_gmTA(s.historia,'sheet-input sheet-textarea',8)}
        </div>
        <div class="sheet-block">
          <div class="sheet-block-title">HISTÓRICO / ORIGEM</div>
          ${_gmTA(s.origin,'sheet-input sheet-textarea',4)}
        </div>
      </div>
    </div>`;

  // Reset para aba PERFIL
  document.querySelectorAll('#gm-sheet-tabs .sheet-tab').forEach((b,i) => b.classList.toggle('active', i===0));

  // Botão editar vitais
  const editBtn = document.getElementById('gm-edit-vitals-btn');
  if (editBtn) { editBtn.onclick = () => { closeModal('modal-gm-sheet'); editPlayerVitals(data.sid); }; }

  _modal.classList.remove('hidden');
  } // fim if(false)
});

function closeSheetModal() {
  const modal = document.getElementById('modal-sheet');
  if (modal.classList.contains('sheet-gm-view')) {
    modal.classList.remove('sheet-gm-view');
    modal._gmViewSid = null;
    const titleEl = document.getElementById('sheet-main-title');
    const banner = document.getElementById('sheet-gm-banner');
    if (titleEl) titleEl.textContent = 'FICHA DE PERSONAGEM';
    if (banner) banner.style.display = 'none';
    loadSheetFromStorage();
  }
  modal.classList.add('hidden');
}

let _vitalsEditTarget = null;

function editPlayerVitals(sid) {
  const p = players[sid];
  if (!p) return;
  const v = p.vitals || {};
  _vitalsEditTarget = sid;
  document.getElementById('vitals-modal-title').textContent =
    sid === socket.id ? '✏️ Meus Vitais' : `✏️ Vitais de ${p.name}`;
  document.getElementById('ve-vida').value = v.vida || 0;
  document.getElementById('ve-vida-max').value = v.vida_max || 60;
  document.getElementById('ve-sanidade').value = v.sanidade || 0;
  document.getElementById('ve-sanidade-max').value = v.sanidade_max || 50;
  document.getElementById('ve-energia').value = v.energia || 0;
  document.getElementById('ve-energia-max').value = v.energia_max || 50;
  document.getElementById('modal-vitals').classList.remove('hidden');
}

function saveVitalsEdit() {
  if (!_vitalsEditTarget) return;
  const p = players[_vitalsEditTarget];
  const v = p?.vitals || {};
  const newVitals = {
    ...v,
    vida: parseInt(document.getElementById('ve-vida').value) || 0,
    vida_max: parseInt(document.getElementById('ve-vida-max').value) || 0,
    sanidade: parseInt(document.getElementById('ve-sanidade').value) || 0,
    sanidade_max: parseInt(document.getElementById('ve-sanidade-max').value) || 0,
    energia: parseInt(document.getElementById('ve-energia').value) || 0,
    energia_max: parseInt(document.getElementById('ve-energia-max').value) || 0
  };
  socket.emit('update_vitals', { room_id: ROOM_ID, target_sid: _vitalsEditTarget, vitals: newVitals });
  closeModal('modal-vitals');
}

socket.on('player_vitals_updated', (data) => {
  if (players[data.sid]) players[data.sid].vitals = data.vitals;
  renderPlayers();
});

// ===================== NÍVEL AUTOMÁTICO =====================
const LEVEL_GAINS = [
  '+3 pontos em atributos, +2 pontos em perícia',
  '+5 pontos em atributos',
  '+1 habilidade criada ou da sua classe, +2 pontos em perícias',
  '+3 pontos em atributos, +2 pontos em perícia',
  '+1 habilidade criada ou da sua classe, +2 pontos em perícias',
  '+5 pontos em atributos',
  '+1 habilidade criada ou da sua classe, +3 pontos em atributo',
  '+3 pontos em atributos, +2 pontos em perícia',
  '+1 habilidade criada ou da sua classe, +2 pontos em perícias',
  '+5 pontos em atributos, +5 pontos em perícia',
  '+3 pontos em atributos, +2 pontos em perícia'
];
const BONUS_GAINS = [
  null,
  'Crie uma ultimate paranormal — +5 pontos em atributos, +5 pontos em perícia',
  'Crie uma habilidade paranormal — +5 pontos em atributos, +5 pontos em perícia',
  'Crie uma habilidade paranormal — +5 pontos em atributos, +5 pontos em perícia',
  'Crie uma habilidade paranormal — +5 pontos em atributos, +5 pontos em perícia',
  'Crie uma ultimate paranormal — +5 pontos em atributos, +5 pontos em perícia'
];
function levelGainText(lvl) { return LEVEL_GAINS[lvl] || ''; }
function bonusGainText(b) { return b > 0 ? BONUS_GAINS[b] : 'Nenhum bônus ainda.'; }

let _levelEditTarget = null;

function openLevelPanel(sid) {
  const p = players[sid];
  if (!p) return;
  const canEdit = isGM && !p.is_gm;
  const level = p.level || 0;
  const bonus = p.bonus_level || 0;
  document.getElementById('level-modal-title').textContent = `🏆 Nível de ${p.name}`;
  document.getElementById('level-modal-view').classList.toggle('hidden', canEdit);
  document.getElementById('level-modal-edit').classList.toggle('hidden', !canEdit);

  if (canEdit) {
    _levelEditTarget = sid;
    const lvSel = document.getElementById('lv-level');
    lvSel.innerHTML = LEVEL_GAINS.map((_, i) => `<option value="${i}">${i}</option>`).join('');
    lvSel.value = level;
    const bonusSel = document.getElementById('lv-bonus');
    bonusSel.innerHTML = [0, 1, 2, 3, 4, 5].map(i => `<option value="${i}">${i === 0 ? 'Nenhum' : i}</option>`).join('');
    bonusSel.value = bonus;
    updateLevelPreview();
  } else {
    document.getElementById('level-view-badge').textContent = `Nível ${level}`;
    document.getElementById('level-view-gain').textContent = levelGainText(level);
    const bonusBadge = document.getElementById('bonus-view-badge');
    const bonusGainEl = document.getElementById('bonus-view-gain');
    bonusBadge.classList.toggle('hidden', bonus === 0);
    if (bonus > 0) {
      bonusBadge.textContent = `Bônus ${bonus}`;
      bonusGainEl.textContent = bonusGainText(bonus);
    } else {
      bonusGainEl.textContent = '';
    }
  }
  document.getElementById('modal-level').classList.remove('hidden');
}

function updateLevelPreview() {
  const lvl = parseInt(document.getElementById('lv-level').value) || 0;
  const bonus = parseInt(document.getElementById('lv-bonus').value) || 0;
  document.getElementById('lv-level-preview').textContent = levelGainText(lvl);
  document.getElementById('lv-bonus-preview').textContent = bonusGainText(bonus);
}

function saveLevelEdit() {
  if (!_levelEditTarget) return;
  const level = parseInt(document.getElementById('lv-level').value) || 0;
  const bonus_level = parseInt(document.getElementById('lv-bonus').value) || 0;
  socket.emit('update_level', { room_id: ROOM_ID, target_sid: _levelEditTarget, level, bonus_level });
  closeModal('modal-level');
}

socket.on('player_level_updated', (data) => {
  if (players[data.sid]) {
    players[data.sid].level = data.level;
    players[data.sid].bonus_level = data.bonus_level;
  }
  renderPlayers();
  if (data.sid === socket.id) updateSheetLevelDisplay();
});

// ===================== FICHA =====================
const SHEET_KEY = 'rpg_sheet_v2';

function switchSheetTab(name, btn) {
  document.querySelectorAll('.stab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.sheet-tab').forEach(b => b.classList.remove('active'));
  document.getElementById('stab-' + name)?.classList.add('active');
  if (btn) btn.classList.add('active');
}

function openSheet() {
  loadSheetFromStorage();
  switchSheetTab('perfil', document.querySelector('.sheet-tab[data-tab="perfil"]'));
  updateSheetLevelDisplay();
  document.getElementById('modal-sheet').classList.remove('hidden');
}

function updateSheetLevelDisplay() {
  const el = document.getElementById('sh-nivel-display');
  if (!el) return;
  const me = players[socket.id] || {};
  const level = me.level || 0;
  const bonus = me.bonus_level || 0;
  el.textContent = bonus > 0 ? `${level} +B${bonus}` : `${level}`;
  el.title = `Nível ${level}: ${levelGainText(level)}${bonus > 0 ? ' • Bônus ' + bonus + ': ' + bonusGainText(bonus) : ''}`;
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
    xp: g('sh-xp'),
    equipamentos: g('sh-equipamentos'), personalidade: g('sh-personalidade'),
    'nao-pode': g('sh-nao-pode'), 'mais-ama': g('sh-mais-ama'),
    'mais-odeia': g('sh-mais-odeia'), 'mais-teme': g('sh-mais-teme'),
    historia: g('sh-historia'), anotacoes: (document.getElementById('sh-anotacoes')||{}).innerHTML || '',
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
  set('sh-xp', s.xp);
  set('sh-equipamentos', s.equipamentos); set('sh-personalidade', s.personalidade);
  set('sh-nao-pode', s['nao-pode']); set('sh-mais-ama', s['mais-ama']);
  set('sh-mais-odeia', s['mais-odeia']); set('sh-mais-teme', s['mais-teme']);
  set('sh-historia', s.historia);
  const notesEl = document.getElementById('sh-anotacoes');
  if (notesEl && s.anotacoes !== undefined) notesEl.innerHTML = s.anotacoes;
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
  item.draggable = true;
  item.innerHTML = `<input type="text" placeholder="Item..." value="${value}"><button class="inv-del" onclick="this.parentElement.remove()">×</button>`;
  item.addEventListener('dragstart', (e) => {
    const val = item.querySelector('input')?.value || '';
    e.dataTransfer.setData('text/plain', val);
  });
  list.appendChild(item);
}

function handleInventoryDrop(e) {
  e.preventDefault();
  const val = e.dataTransfer.getData('text/plain');
  if (!val) return;
  const input = document.getElementById('chat-input');
  if (!input) return;
  input.value = (input.value ? input.value + ' ' : '') + `usa: ${val}`;
  input.focus();
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

// ===================== NOTES EDITOR =====================
let _activeNoteEditorId = 'sh-anotacoes';

function _noteInsertImg(src) {
  const el = document.getElementById(_activeNoteEditorId);
  if (!el) return;
  el.focus();
  document.execCommand('insertHTML', false,
    `<img src="${src}" style="max-width:100%;border-radius:6px;margin:6px 0;display:block;cursor:pointer">`);
}

function _noteResizeAndInsert(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const maxW = 800;
      const scale = img.width > maxW ? maxW / img.width : 1;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      _noteInsertImg(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function noteInsertFile(input) {
  const file = input.files[0];
  if (!file) return;
  _noteResizeAndInsert(file);
  input.value = '';
}

function notePromptURL() {
  const url = prompt('Cole a URL da imagem:');
  if (url && url.trim()) _noteInsertImg(url.trim());
}

let _selectedNoteImg = null;

function _showNoteImgToolbar(img) {
  _selectedNoteImg = img;
  img.classList.add('note-img-selected');
  const tb = document.getElementById('note-img-toolbar');
  const input = document.getElementById('note-img-w');
  if (tb) tb.classList.remove('hidden');
  if (input) {
    const w = img.style.width ? parseInt(img.style.width) : 100;
    input.value = isNaN(w) ? 100 : w;
  }
}

function _hideNoteImgToolbar() {
  if (_selectedNoteImg) {
    _selectedNoteImg.classList.remove('note-img-selected');
    _selectedNoteImg = null;
  }
  document.getElementById('note-img-toolbar')?.classList.add('hidden');
}

function noteImgSize(pct) {
  if (!_selectedNoteImg) return;
  _selectedNoteImg.style.width = pct + '%';
  _selectedNoteImg.style.maxWidth = '100%';
  const input = document.getElementById('note-img-w');
  if (input) input.value = pct;
}

function noteImgDelete() {
  if (!_selectedNoteImg) return;
  _selectedNoteImg.remove();
  _hideNoteImgToolbar();
}

const _noteEditorIds = [];

function initNoteEditor(editorId) {
  editorId = editorId || 'sh-anotacoes';
  const el = document.getElementById(editorId);
  if (!el) return;
  _noteEditorIds.push(editorId);

  el.addEventListener('focus', () => { _activeNoteEditorId = editorId; });
  el.addEventListener('click', (e) => {
    _activeNoteEditorId = editorId;
    if (e.target.tagName === 'IMG') {
      e.preventDefault();
      _showNoteImgToolbar(e.target);
    } else {
      _hideNoteImgToolbar();
    }
  });

  document.addEventListener('click', (e) => {
    if (_selectedNoteImg &&
        !e.target.closest('#note-img-toolbar') &&
        !_noteEditorIds.some(id => e.target.closest('#' + id))) {
      _hideNoteImgToolbar();
    }
  });

  const wInput = document.getElementById('note-img-w');
  if (wInput && !wInput.dataset.wired) {
    wInput.dataset.wired = '1';
    wInput.addEventListener('input', () => {
      const v = parseInt(wInput.value);
      if (_selectedNoteImg && v >= 10 && v <= 100) {
        _selectedNoteImg.style.width = v + '%';
        _selectedNoteImg.style.maxWidth = '100%';
      }
    });
  }

  el.addEventListener('paste', (e) => {
    _activeNoteEditorId = editorId;
    const items = e.clipboardData?.items || [];
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        _noteResizeAndInsert(item.getAsFile());
        return;
      }
    }
    const text = (e.clipboardData?.getData('text') || '').trim();
    if (/^https?:\/\/.+\.(jpg|jpeg|png|gif|webp|svg|bmp)(\?.*)?$/i.test(text)) {
      e.preventDefault();
      _noteInsertImg(text);
      return;
    }
    if (text) {
      e.preventDefault();
      document.execCommand('insertText', false, text);
    }
  });
}

function loadSheetAvatar(event) {
  const file = event.target.files[0]; if (!file) return;
  openAvatarCropper(file, (croppedDataUrl) => {
    const img = document.getElementById('sh-avatar');
    const ph = document.getElementById('sh-avatar-placeholder');
    const ctrl = document.getElementById('sh-avatar-controls');
    img.src = croppedDataUrl; img.style.display = 'block';
    if (ph) ph.style.display = 'none';
    if (ctrl) ctrl.style.display = 'flex';
  });
  event.target.value = '';
}

document.getElementById('sh-avatar-slot').addEventListener('click', (e) => {
  if (e.target.closest('.sheet-avatar-controls')) return;
  document.getElementById('sh-img-upload').click();
});

// ===================== AVATAR DO GM =====================
function gmAvatarClick() {
  if (!isGM) return;
  document.getElementById('gm-avatar-upload').click();
}

function setGMAvatar(event) {
  const file = event.target.files[0]; if (!file) return;
  openAvatarCropper(file, (dataUrl) => {
    sessionStorage.setItem('gm_avatar', dataUrl);
    // Atualiza avatar na nav
    const el = document.getElementById('nav-avatar');
    if (el) el.innerHTML = `<img src="${dataUrl}" alt="">`;
    // Compartilha com todos via share_sheet (reusa o mecanismo existente)
    socket.emit('share_sheet', { room_id: ROOM_ID, sheet: { avatar: dataUrl, name: playerName } });
  });
  event.target.value = '';
}

// ===================== RECORTE DE FOTO (estilo Instagram) =====================
const CROP_VIEWPORT = 280;
const CROP_OUTPUT = 500;
let _cropScale = 1, _cropMinScale = 1, _cropOffsetX = 0, _cropOffsetY = 0;
let _cropOnConfirm = null;
let _cropDragging = false, _cropDragStart = { x: 0, y: 0 };
let _cropPinching = false, _cropPinchStartDist = 0, _cropPinchStartScale = 1;

function openAvatarCropper(file, onConfirm) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = document.getElementById('crop-img');
    img.onload = () => {
      _cropMinScale = CROP_VIEWPORT / Math.min(img.naturalWidth, img.naturalHeight);
      _cropScale = _cropMinScale;
      img.style.width = (img.naturalWidth * _cropScale) + 'px';
      img.style.height = (img.naturalHeight * _cropScale) + 'px';
      _cropOffsetX = (CROP_VIEWPORT - img.naturalWidth * _cropScale) / 2;
      _cropOffsetY = (CROP_VIEWPORT - img.naturalHeight * _cropScale) / 2;
      applyCropTransform();
      document.getElementById('crop-zoom-slider').value = 1;
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
  _cropOnConfirm = onConfirm;
  document.getElementById('modal-avatar-crop').classList.remove('hidden');
}

function applyCropTransform() {
  const img = document.getElementById('crop-img');
  img.style.left = _cropOffsetX + 'px';
  img.style.top = _cropOffsetY + 'px';
}

function clampCropOffset() {
  const img = document.getElementById('crop-img');
  const w = img.naturalWidth * _cropScale, h = img.naturalHeight * _cropScale;
  const minX = Math.min(0, CROP_VIEWPORT - w), minY = Math.min(0, CROP_VIEWPORT - h);
  _cropOffsetX = Math.max(minX, Math.min(0, _cropOffsetX));
  _cropOffsetY = Math.max(minY, Math.min(0, _cropOffsetY));
}

function setCropScale(newScale) {
  const img = document.getElementById('crop-img');
  newScale = Math.max(_cropMinScale, Math.min(_cropMinScale * 4, newScale));
  const center = CROP_VIEWPORT / 2;
  const imgPointX = (center - _cropOffsetX) / _cropScale;
  const imgPointY = (center - _cropOffsetY) / _cropScale;
  _cropScale = newScale;
  img.style.width = (img.naturalWidth * _cropScale) + 'px';
  img.style.height = (img.naturalHeight * _cropScale) + 'px';
  _cropOffsetX = center - imgPointX * _cropScale;
  _cropOffsetY = center - imgPointY * _cropScale;
  clampCropOffset();
  applyCropTransform();
}

function onCropZoomSlider(val) {
  setCropScale(_cropMinScale * parseFloat(val));
}

function cancelAvatarCrop() {
  document.getElementById('modal-avatar-crop').classList.add('hidden');
  _cropOnConfirm = null;
}

function confirmAvatarCrop() {
  const img = document.getElementById('crop-img');
  const canvas = document.createElement('canvas');
  canvas.width = CROP_OUTPUT; canvas.height = CROP_OUTPUT;
  const ctx = canvas.getContext('2d');
  const k = CROP_OUTPUT / CROP_VIEWPORT;
  ctx.drawImage(
    img, 0, 0, img.naturalWidth, img.naturalHeight,
    _cropOffsetX * k, _cropOffsetY * k,
    img.naturalWidth * _cropScale * k, img.naturalHeight * _cropScale * k
  );
  const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
  const cb = _cropOnConfirm;
  cancelAvatarCrop();
  if (cb) cb(dataUrl);
}

function _touchDist(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

(function initCropViewport() {
  const vp = document.getElementById('crop-viewport');
  vp.addEventListener('mousedown', (e) => {
    _cropDragging = true;
    _cropDragStart = { x: e.clientX - _cropOffsetX, y: e.clientY - _cropOffsetY };
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (!_cropDragging) return;
    _cropOffsetX = e.clientX - _cropDragStart.x;
    _cropOffsetY = e.clientY - _cropDragStart.y;
    clampCropOffset();
    applyCropTransform();
  });
  document.addEventListener('mouseup', () => { _cropDragging = false; });

  vp.addEventListener('wheel', (e) => {
    e.preventDefault();
    setCropScale(_cropScale * (e.deltaY < 0 ? 1.08 : 0.93));
    document.getElementById('crop-zoom-slider').value = (_cropScale / _cropMinScale).toFixed(2);
  }, { passive: false });

  vp.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      _cropDragging = true;
      _cropDragStart = { x: e.touches[0].clientX - _cropOffsetX, y: e.touches[0].clientY - _cropOffsetY };
    } else if (e.touches.length === 2) {
      _cropDragging = false;
      _cropPinching = true;
      _cropPinchStartDist = _touchDist(e.touches);
      _cropPinchStartScale = _cropScale;
    }
  }, { passive: true });
  vp.addEventListener('touchmove', (e) => {
    if (_cropPinching && e.touches.length === 2) {
      const dist = _touchDist(e.touches);
      setCropScale(_cropPinchStartScale * (dist / _cropPinchStartDist));
      document.getElementById('crop-zoom-slider').value = (_cropScale / _cropMinScale).toFixed(2);
    } else if (_cropDragging && e.touches.length === 1) {
      _cropOffsetX = e.touches[0].clientX - _cropDragStart.x;
      _cropOffsetY = e.touches[0].clientY - _cropDragStart.y;
      clampCropOffset();
      applyCropTransform();
    }
  }, { passive: true });
  vp.addEventListener('touchend', () => { _cropDragging = false; _cropPinching = false; });
})();

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
    if (e.target.tagName === 'BUTTON') return;
    const panel = document.getElementById('turn-queue');
    const r = panel.getBoundingClientRect();
    _tqDrag = { sx: e.clientX, sy: e.clientY, t: r.top, l: r.left };
    e.preventDefault();
  });
}

// Movimento de tokens por teclado (WASD / setas) quando no mapa
document.addEventListener('keydown', (e) => {
  if (!mapInited) return;
  if (!selectedTokenIds.size) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  const viewMap = document.getElementById('view-map');
  if (!viewMap || !viewMap.classList.contains('active')) return;
  let dx = 0, dy = 0;
  const gs = mapState.grid_size;
  if (e.key === 'ArrowLeft'  || e.key === 'a' || e.key === 'A') dx = -gs;
  else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') dx = gs;
  else if (e.key === 'ArrowUp'    || e.key === 'w' || e.key === 'W') dy = -gs;
  else if (e.key === 'ArrowDown'  || e.key === 's' || e.key === 'S') dy = gs;
  else return;
  e.preventDefault();
  for (const id of selectedTokenIds) {
    if (tokens[id]) {
      tokens[id].x += dx; tokens[id].y += dy;
      socket.emit('token_move', { room_id: ROOM_ID, token_id: id, x: tokens[id].x, y: tokens[id].y });
    }
  }
  drawMap();
});

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
  initNoteEditor('sh-anotacoes');
  initNoteEditor('lib-page-content');
  updateAttrPoints(); updatePerPoints();
  addInventoryItem('');
  if (isGM) {
    loadMonsters(); loadBattleNotes(); loadCombatQueue();
    // Restaura avatar do GM se já definiu antes
    const savedAvatar = sessionStorage.getItem('gm_avatar');
    if (savedAvatar) {
      const el = document.getElementById('nav-avatar');
      if (el) el.innerHTML = `<img src="${savedAvatar}" alt="">`;
    }
    // Torna o nav-avatar clicável para o GM
    const navAv = document.getElementById('nav-avatar');
    if (navAv) navAv.style.cursor = 'pointer';
  }

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

  // Ajusta altura quando teclado virtual abre (fallback para browsers sem dvh)
  if (window.visualViewport && window.innerWidth <= 768) {
    const appBody = document.getElementById('app-body');
    window.visualViewport.addEventListener('resize', () => {
      if (appBody) appBody.style.height = (window.visualViewport.height - 56) + 'px';
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
