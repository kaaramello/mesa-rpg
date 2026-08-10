const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  maxHttpBufferSize: 10e6,
  transports: ['websocket', 'polling'],
  allowEIO3: true
});

app.use('/static', express.static(path.join(__dirname, 'static')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'templates', 'index.html'));
});


app.get('/room/:roomId', (req, res) => {
  let html = fs.readFileSync(path.join(__dirname, 'templates', 'room.html'), 'utf8');
  html = html.replace(/\{\{\s*room_id\s*\}\}/g, req.params.roomId);
  res.send(html);
});

// ===================== PERSISTÊNCIA =====================
const DATA_DIR = path.join(__dirname, 'data');
const SAVE_FILE = path.join(DATA_DIR, 'rooms.json');

function loadRooms() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(SAVE_FILE)) return;
    const raw = fs.readFileSync(SAVE_FILE, 'utf8');
    const saved = JSON.parse(raw);
    for (const [id, data] of Object.entries(saved)) {
      rooms[id] = {
        players: {},
        tokens: data.tokens || {},
        pins: data.pins || {},
        messages: data.messages || [],
        map: data.map || { background: null, grid_size: 50, show_grid: true, width: 3000, height: 2000 },
        notes: data.notes || '',
        library: data.library || {}
      };
    }
    console.log(`Salas carregadas: ${Object.keys(saved).join(', ') || '(nenhuma)'}`);
  } catch (e) {
    console.error('Erro ao carregar salas:', e.message);
  }
}

let _saveTimer = null;
function saveRooms() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      const toSave = {};
      for (const [id, room] of Object.entries(rooms)) {
        toSave[id] = {
          messages: room.messages.slice(-500),
          tokens: room.tokens,
          pins: room.pins,
          map: room.map,
          notes: room.notes,
          library: room.library
        };
      }
      fs.writeFileSync(SAVE_FILE, JSON.stringify(toSave, null, 2), 'utf8');
    } catch (e) {
      console.error('Erro ao salvar salas:', e.message);
    }
  }, 2000);
}

// ===================== ESTADO =====================
const rooms = {};
loadRooms();

function getRoom(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      players: {},
      tokens: {},
      pins: {},
      messages: [],
      map: { background: null, grid_size: 50, show_grid: true, width: 3000, height: 2000 },
      notes: '',
      library: {}
    };
  }
  return rooms[roomId];
}

function msgId() {
  return crypto.randomBytes(4).toString('hex');
}

// Sussurros só devem ser entregues/reidratados para autor, alvo(s) e GM
function isWhisperVisibleTo(msg, player) {
  if (msg.type !== 'whisper') return true;
  if (!player) return false;
  if (player.is_gm) return true;
  if (player.name === msg.author) return true;
  return !!(msg.target && player.name.toLowerCase() === msg.target.toLowerCase());
}

// Emite um evento sobre uma mensagem (edição/exclusão) só para quem podia ver o sussurro original
function emitToMsgAudience(io, room, roomId, msg, event, payload) {
  if (msg.type !== 'whisper') { io.to(roomId).emit(event, payload); return; }
  for (const [sid, p] of Object.entries(room.players)) {
    if (isWhisperVisibleTo(msg, p)) io.to(sid).emit(event, payload);
  }
}

function broadcastPlayers(roomId, room) {
  const list = {};
  for (const [sid, p] of Object.entries(room.players)) {
    list[sid] = { name: p.name, is_gm: p.is_gm, vitals: p.vitals || {}, level: p.level || 0, bonus_level: p.bonus_level || 0 };
  }
  io.to(roomId).emit('player_list', list);
}

// ===================== SOCKET EVENTS =====================
io.on('connection', (socket) => {

  socket.on('join', (data) => {
    const { room_id, player_name, is_gm, token } = data;
    const playerToken = token || socket.id;
    const room = getRoom(room_id);

    // Remove sessão anterior do mesmo token (reconexão / outra aba)
    for (const [existingSid, p] of Object.entries(room.players)) {
      if (p.token === playerToken && existingSid !== socket.id) {
        io.to(existingSid).emit('kicked', { reason: 'Nova sessão iniciada.' });
        delete room.players[existingSid];
        const s = io.sockets.sockets.get(existingSid);
        if (s) s.disconnect(true);
        break;
      }
    }

    socket.join(room_id);
    room.players[socket.id] = {
      name: player_name, is_gm: !!is_gm,
      sid: socket.id, token: playerToken, vitals: {},
      level: 0, bonus_level: 0
    };
    const me = room.players[socket.id];

    const visibleTokens = {};
    for (const [id, t] of Object.entries(room.tokens)) {
      if (!t.hidden || me.is_gm) visibleTokens[id] = t;
    }
    const visiblePins = {};
    for (const [id, p] of Object.entries(room.pins)) {
      if (!p.hidden || me.is_gm) visiblePins[id] = p;
    }

    socket.emit('room_state', {
      tokens: visibleTokens,
      pins: visiblePins,
      messages: room.messages.slice(-200).filter(m => isWhisperVisibleTo(m, me)),
      map: room.map,
      notes: room.notes,
      library: room.library
    });

    broadcastPlayers(room_id, room);

    const msg = { type: 'system', text: `${player_name} entrou na sala.`, id: msgId() };
    room.messages.push(msg);
    io.to(room_id).emit('new_message', msg);
    saveRooms();
  });

  socket.on('disconnect', () => {
    for (const [roomId, room] of Object.entries(rooms)) {
      if (room.players[socket.id]) {
        const name = room.players[socket.id].name;
        delete room.players[socket.id];
        const msg = { type: 'system', text: `${name} saiu da sala.`, id: msgId() };
        room.messages.push(msg);
        io.to(roomId).emit('new_message', msg);
        broadcastPlayers(roomId, room);
        saveRooms();
        break;
      }
    }
  });

  socket.on('chat_message', (data) => {
    const room = rooms[data.room_id];
    if (!room) return;
    const player = room.players[socket.id] || { name: 'Desconhecido' };
    let msg;
    if (data.chat_type === 'narrador') {
      msg = { type: 'narrador', author: 'Narrador', realAuthor: player.name, text: data.text, id: msgId() };
    } else if (data.chat_type === 'persona' && data.persona) {
      const persona = String(data.persona).slice(0, 32);
      msg = { type: 'persona', author: persona, realAuthor: player.name, text: data.text, id: msgId() };
    } else if (data.chat_type === 'highlight') {
      msg = { type: 'highlight', author: player.name, origAuthor: String(data.origAuthor || '').slice(0, 40), text: data.text, id: msgId() };
    } else if (data.chat_type === 'whisper' && data.target) {
      msg = { type: 'whisper', author: player.name, target: String(data.target).slice(0, 40), text: data.text, id: msgId() };
    } else {
      msg = { type: 'chat', author: player.name, text: data.text, id: msgId() };
    }
    room.messages.push(msg);
    emitToMsgAudience(io, room, data.room_id, msg, 'new_message', msg);
    saveRooms();
  });

  socket.on('clear_chat', (data) => {
    const room = rooms[data.room_id];
    if (!room) return;
    const player = room.players[socket.id];
    if (!player?.is_gm) return;
    room.messages = [];
    io.to(data.room_id).emit('chat_cleared');
    const msg = { type: 'system', text: `🗑️ O chat foi limpo por ${player.name}.`, id: msgId() };
    room.messages.push(msg);
    io.to(data.room_id).emit('new_message', msg);
    saveRooms();
  });

  socket.on('roll_dice', (data) => {
    const room = rooms[data.room_id];
    if (!room) return;
    const player = room.players[socket.id] || { name: 'Desconhecido' };
    const sides = parseInt(data.dice);
    const modifier = parseInt(data.modifier || 0);
    const count = parseInt(data.count || 1);
    const rolls = Array.from({ length: count }, () => Math.floor(Math.random() * sides) + 1);
    const total = rolls.reduce((a, b) => a + b, 0) + modifier;
    const modStr = modifier > 0 ? ` + ${modifier}` : modifier < 0 ? ` - ${Math.abs(modifier)}` : '';
    const rollsStr = rolls.length > 1 ? rolls.join(' + ') : String(rolls[0]);
    const detail = (rolls.length > 1 || modifier !== 0)
      ? `[${rollsStr}]${modStr} = **${total}**`
      : `**${total}**`;
    const msg = {
      type: 'roll', author: player.name,
      text: `rolou ${count}d${sides}${modStr}: ${detail}`,
      rolls, total, id: msgId()
    };
    room.messages.push(msg);
    io.to(data.room_id).emit('new_message', msg);
    saveRooms();
  });

  socket.on('token_add', (data) => {
    const room = rooms[data.room_id];
    if (!room) return;
    room.tokens[data.token.id] = data.token;
    io.to(data.room_id).emit('token_added', data.token);
    saveRooms();
  });

  socket.on('token_move', (data) => {
    const room = rooms[data.room_id];
    if (!room || !room.tokens[data.token_id]) return;
    room.tokens[data.token_id].x = data.x;
    room.tokens[data.token_id].y = data.y;
    const payload = { token_id: data.token_id, x: data.x, y: data.y };
    if (room.tokens[data.token_id].hidden) {
      for (const [sid, p] of Object.entries(room.players)) if (p.is_gm) io.to(sid).emit('token_moved', payload);
    } else {
      io.to(data.room_id).emit('token_moved', payload);
    }
    saveRooms();
  });

  socket.on('token_remove', (data) => {
    const room = rooms[data.room_id];
    if (!room) return;
    delete room.tokens[data.token_id];
    io.to(data.room_id).emit('token_removed', { token_id: data.token_id });
    saveRooms();
  });

  socket.on('token_update', (data) => {
    const room = rooms[data.room_id];
    if (!room || !room.tokens[data.token.id]) return;
    const wasHidden = !!room.tokens[data.token.id].hidden;
    Object.assign(room.tokens[data.token.id], data.token);
    const full = room.tokens[data.token.id];
    if (full.hidden) {
      // Só o GM continua vendo; quem via antes precisa "esquecer" o token
      for (const [sid, p] of Object.entries(room.players)) {
        if (p.is_gm) io.to(sid).emit('token_updated', full);
        else if (!wasHidden) io.to(sid).emit('token_removed', { token_id: full.id });
      }
    } else {
      io.to(data.room_id).emit('token_updated', full);
    }
    saveRooms();
  });

  socket.on('map_update', (data) => {
    const room = rooms[data.room_id];
    if (!room) return;
    Object.assign(room.map, data.map);
    io.to(data.room_id).emit('map_updated', data.map);
    saveRooms();
  });

  socket.on('pin_add', (data) => {
    const room = rooms[data.room_id];
    if (!room) return;
    const player = room.players[socket.id];
    if (!player?.is_gm) return;
    room.pins[data.pin.id] = data.pin;
    io.to(data.room_id).emit('pin_added', data.pin);
    saveRooms();
  });

  socket.on('pin_remove', (data) => {
    const room = rooms[data.room_id];
    if (!room) return;
    const player = room.players[socket.id];
    if (!player?.is_gm) return;
    delete room.pins[data.pin_id];
    io.to(data.room_id).emit('pin_removed', { pin_id: data.pin_id });
    saveRooms();
  });

  socket.on('pin_update', (data) => {
    const room = rooms[data.room_id];
    if (!room) return;
    const player = room.players[socket.id];
    if (!player?.is_gm) return;
    if (!room.pins[data.pin.id]) return;
    const wasHidden = !!room.pins[data.pin.id].hidden;
    Object.assign(room.pins[data.pin.id], data.pin);
    const full = room.pins[data.pin.id];
    if (full.hidden) {
      for (const [sid, p] of Object.entries(room.players)) {
        if (p.is_gm) io.to(sid).emit('pin_updated', full);
        else if (!wasHidden) io.to(sid).emit('pin_removed', { pin_id: full.id });
      }
    } else {
      io.to(data.room_id).emit('pin_updated', full);
    }
    saveRooms();
  });

  socket.on('share_sheet', (data) => {
    const room = rooms[data.room_id];
    if (!room) return;
    const sheet = data.sheet || {};
    if (room.players[socket.id]) {
      room.players[socket.id].sheet = sheet;
      room.players[socket.id].vitals = {
        vida: sheet.vida || '', vida_max: sheet['vida-max'] || '',
        sanidade: sheet.sanidade || '', sanidade_max: sheet['sanidade-max'] || '',
        energia: sheet.energia || '', energia_max: sheet['energia-max'] || '',
        avatar: sheet.avatar || null, char_name: sheet.name || ''
      };
    }
    io.to(data.room_id).emit('player_vitals_updated', {
      sid: socket.id, vitals: room.players[socket.id]?.vitals || {}
    });
    broadcastPlayers(data.room_id, room);
  });

  socket.on('request_player_sheet', (data) => {
    const room = rooms[data.room_id];
    if (!room) return;
    const requester = room.players[socket.id];
    if (requester?.is_gm) {
      const sheet = room.players[data.target_sid]?.sheet || {};
      socket.emit('player_sheet_data', { sid: data.target_sid, sheet });
    }
  });

  socket.on('update_vitals', (data) => {
    const room = rooms[data.room_id];
    if (!room) return;
    const targetSid = data.target_sid || socket.id;
    const requester = room.players[socket.id];
    if (targetSid === socket.id || requester?.is_gm) {
      if (room.players[targetSid]) room.players[targetSid].vitals = data.vitals;
      io.to(data.room_id).emit('player_vitals_updated', { sid: targetSid, vitals: data.vitals });
      broadcastPlayers(data.room_id, room);
    }
  });

  socket.on('update_level', (data) => {
    const room = rooms[data.room_id];
    if (!room) return;
    const requester = room.players[socket.id];
    if (!requester?.is_gm) return;
    const target = room.players[data.target_sid];
    if (!target) return;
    target.level = Math.max(0, Math.min(10, parseInt(data.level) || 0));
    target.bonus_level = Math.max(0, Math.min(5, parseInt(data.bonus_level) || 0));
    io.to(data.room_id).emit('player_level_updated', { sid: data.target_sid, level: target.level, bonus_level: target.bonus_level });
    broadcastPlayers(data.room_id, room);
    saveRooms();
  });

  function collectLibraryDescendants(library, id) {
    const result = [id];
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop();
      for (const item of Object.values(library)) {
        if (item.parentId === cur) { result.push(item.id); stack.push(item.id); }
      }
    }
    return result;
  }

  socket.on('library_create', (data) => {
    const room = rooms[data.room_id];
    if (!room) return;
    const player = room.players[socket.id];
    if (!player?.is_gm) return;
    const type = data.type === 'folder' ? 'folder' : 'page';
    const item = {
      id: msgId(), type,
      name: String(data.name || (type === 'folder' ? 'Nova pasta' : 'Nova página')).slice(0, 80),
      parentId: data.parentId || null
    };
    if (type === 'page') item.content = '';
    room.library[item.id] = item;
    io.to(data.room_id).emit('library_item_created', item);
    saveRooms();
  });

  socket.on('library_rename', (data) => {
    const room = rooms[data.room_id];
    if (!room) return;
    const player = room.players[socket.id];
    if (!player?.is_gm) return;
    const item = room.library[data.id];
    if (!item) return;
    item.name = String(data.name || '').trim().slice(0, 80) || (item.type === 'folder' ? 'Nova pasta' : 'Nova página');
    io.to(data.room_id).emit('library_item_renamed', { id: item.id, name: item.name });
    saveRooms();
  });

  socket.on('library_update_content', (data) => {
    const room = rooms[data.room_id];
    if (!room) return;
    const player = room.players[socket.id];
    if (!player?.is_gm) return;
    const item = room.library[data.id];
    if (!item || item.type !== 'page') return;
    item.content = String(data.content || '').slice(0, 200000);
    io.to(data.room_id).emit('library_item_updated', { id: item.id, content: item.content });
    saveRooms();
  });

  socket.on('library_delete', (data) => {
    const room = rooms[data.room_id];
    if (!room) return;
    const player = room.players[socket.id];
    if (!player?.is_gm) return;
    if (!room.library[data.id]) return;
    const ids = collectLibraryDescendants(room.library, data.id);
    ids.forEach(id => delete room.library[id]);
    io.to(data.room_id).emit('library_item_deleted', { deletedIds: ids });
    saveRooms();
  });

  socket.on('file_message', (data) => {
    const room = rooms[data.room_id];
    if (!room) return;
    const player = room.players[socket.id] || { name: 'Desconhecido' };
    const category = ['enemy', 'clue', 'npc'].includes(data.category) ? data.category : 'none';
    const msg = {
      type: 'file', author: player.name,
      filename: data.filename, filetype: data.filetype, filedata: data.filedata,
      category, id: msgId()
    };
    io.to(data.room_id).emit('new_message', msg);
  });

  socket.on('delete_message', (data) => {
    const room = rooms[data.room_id];
    if (!room) return;
    const player = room.players[socket.id];
    if (!player) return;
    const msg = room.messages.find(m => m.id === data.msg_id);
    if (!msg) return;
    const isAuthor = msg.author === player.name || msg.realAuthor === player.name;
    if (!isAuthor && !player.is_gm) return;
    msg.deleted = true;
    msg.deletedBy = player.name;
    msg.deletedAt = Date.now();
    emitToMsgAudience(io, room, data.room_id, msg, 'message_deleted', { msg_id: data.msg_id, deletedBy: msg.deletedBy });
    saveRooms();
  });

  socket.on('edit_message', (data) => {
    const room = rooms[data.room_id];
    if (!room) return;
    const player = room.players[socket.id];
    if (!player) return;
    const msg = room.messages.find(m => m.id === data.msg_id);
    if (!msg) return;
    if (msg.type === 'roll' || msg.type === 'system' || msg.type === 'file' || msg.deleted) return;
    const isAuthor = msg.author === player.name || msg.realAuthor === player.name;
    if (!isAuthor) return;
    if (!msg.edits) msg.edits = [];
    msg.edits.push({ text: msg.text, editedAt: Date.now() });
    msg.text = String(data.text || '').slice(0, 700);
    msg.edited = true;
    emitToMsgAudience(io, room, data.room_id, msg, 'message_edited', { msg_id: data.msg_id, text: msg.text, editCount: msg.edits.length });
    saveRooms();
  });

  socket.on('attr_roll', (data) => {
    const room = rooms[data.room_id];
    if (!room) return;
    const player = room.players[socket.id] || { name: 'Desconhecido' };
    const label = String(data.label || 'Atributo').slice(0, 40);
    const value = parseInt(data.value) || 0;
    const roll = Math.floor(Math.random() * 12) + 1;
    const total = roll + value;
    const success = total >= 12;
    const msg = {
      type: 'roll', author: player.name,
      text: `testou ${label} (+${value}): 1d12 (${roll}) + ${value} = **${total}** → ${success ? 'SUCESSO ✅' : 'FALHA ❌'}`,
      rolls: [roll], total, id: msgId()
    };
    room.messages.push(msg);
    io.to(data.room_id).emit('new_message', msg);
    saveRooms();
  });

  socket.on('notes_update', (data) => {
    const room = rooms[data.room_id];
    if (!room) return;
    room.notes = String(data.notes || '').slice(0, 20000);
    io.to(data.room_id).emit('notes_updated', { notes: room.notes });
    saveRooms();
  });
});

function createServer(port) {
  return new Promise((resolve) => {
    server.listen(port, () => {
      console.log(`Mesa RPG Digital rodando na porta ${port}`);
      resolve();
    });
  });
}

// Roda direto se não for importado pelo Electron
if (require.main === module) {
  const PORT = process.env.PORT || 5000;
  createServer(PORT);
}

module.exports = { createServer };
