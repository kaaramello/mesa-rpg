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
        map: data.map || { background: null, grid_size: 50, show_grid: true, width: 3000, height: 2000 }
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
          map: room.map
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
      map: { background: null, grid_size: 50, show_grid: true, width: 3000, height: 2000 }
    };
  }
  return rooms[roomId];
}

function msgId() {
  return crypto.randomBytes(4).toString('hex');
}

function broadcastPlayers(roomId, room) {
  const list = {};
  for (const [sid, p] of Object.entries(room.players)) {
    list[sid] = { name: p.name, is_gm: p.is_gm, vitals: p.vitals || {} };
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
      sid: socket.id, token: playerToken, vitals: {}
    };

    socket.emit('room_state', {
      tokens: room.tokens,
      pins: room.pins,
      messages: room.messages.slice(-200),
      map: room.map
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
    } else {
      msg = { type: 'chat', author: player.name, text: data.text, id: msgId() };
    }
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
    io.to(data.room_id).emit('token_moved', { token_id: data.token_id, x: data.x, y: data.y });
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
    Object.assign(room.tokens[data.token.id], data.token);
    io.to(data.room_id).emit('token_updated', data.token);
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
    if (room.pins[data.pin.id]) Object.assign(room.pins[data.pin.id], data.pin);
    io.to(data.room_id).emit('pin_updated', data.pin);
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

  socket.on('file_message', (data) => {
    const room = rooms[data.room_id];
    if (!room) return;
    const player = room.players[socket.id] || { name: 'Desconhecido' };
    const msg = {
      type: 'file', author: player.name,
      filename: data.filename, filetype: data.filetype, filedata: data.filedata,
      id: msgId()
    };
    io.to(data.room_id).emit('new_message', msg);
  });

  socket.on('delete_message', (data) => {
    const room = rooms[data.room_id];
    if (!room) return;
    const player = room.players[socket.id];
    if (!player) return;
    const idx = room.messages.findIndex(m => m.id === data.msg_id);
    if (idx === -1) return;
    const msg = room.messages[idx];
    const isAuthor = msg.author === player.name || msg.realAuthor === player.name;
    if (!isAuthor && !player.is_gm) return;
    room.messages.splice(idx, 1);
    io.to(data.room_id).emit('message_deleted', { msg_id: data.msg_id });
    saveRooms();
  });

  socket.on('edit_message', (data) => {
    const room = rooms[data.room_id];
    if (!room) return;
    const player = room.players[socket.id];
    if (!player) return;
    const msg = room.messages.find(m => m.id === data.msg_id);
    if (!msg) return;
    if (msg.type === 'roll' || msg.type === 'system' || msg.type === 'file') return;
    const isAuthor = msg.author === player.name || msg.realAuthor === player.name;
    if (!isAuthor) return;
    msg.text = String(data.text || '').slice(0, 700);
    msg.edited = true;
    io.to(data.room_id).emit('message_edited', { msg_id: data.msg_id, text: msg.text });
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
