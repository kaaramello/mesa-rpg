// SocketShim — API idêntica ao Socket.IO, conecta ao Supabase Realtime
// Uso: const socket = new SocketShim(ROOM_ID, playerName, isGM, SESSION_TOKEN);
//       await socket.connect();

class SocketShim {
  constructor(roomId, playerName, isGM, sessionToken) {
    this.roomId    = roomId;
    this.playerName = playerName;
    this.isGM      = isGM;
    this.id        = sessionToken;   // equivalente ao socket.id
    this._handlers = {};
    this._ch       = null;           // canal Realtime principal
    this._db       = window._sb;     // cliente Supabase global
    this._myVitals = {};
    this._myLevel  = 0;
    this._myBonus  = 0;
    // presença local para evitar reprocessar mudanças próprias
    this._pendingMsgIds = new Set();
  }

  // ── Registro de handlers ────────────────────────────────────────────────
  on(event, handler) {
    (this._handlers[event] = this._handlers[event] || []).push(handler);
    return this;
  }
  off(event, handler) {
    if (!this._handlers[event]) return;
    this._handlers[event] = this._handlers[event].filter(h => h !== handler);
  }
  _fire(event, ...args) {
    for (const h of (this._handlers[event] || [])) h(...args);
  }

  // ── emit público ────────────────────────────────────────────────────────
  async emit(event, data, cb) {
    try {
      const result = await this._route(event, data || {});
      if (cb) cb(result);
    } catch (e) {
      console.error('[shim] emit error:', event, e);
      if (cb) cb({ error: e?.message || String(e) });
    }
  }

  // ── Conexão principal ───────────────────────────────────────────────────
  async connect() {
    const db = this._db;

    // Garante que a sala existe
    await db.from('rooms').upsert({ id: this.roomId }, { onConflict: 'id', ignoreDuplicates: true });

    // Canal Realtime (presença + broadcast + postgres_changes)
    this._ch = db.channel('room:' + this.roomId, {
      config: { presence: { key: this.id } }
    });

    // ── PRESENÇA ──
    this._ch.on('presence', { event: 'sync' }, () => this._syncPlayers());

    // ── BROADCAST (eventos efêmeros) ──
    this._ch.on('broadcast', { event: 'chat_cleared' }, () => this._fire('chat_cleared'));
    this._ch.on('broadcast', { event: 'kicked' }, ({ payload }) => {
      if (payload?.target === this.id) this._fire('kicked', payload);
    });

    // ── POSTGRES CHANGES ──
    this._ch
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${this.roomId}` }, (p) => this._onMsgChange('INSERT', p.new))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `room_id=eq.${this.roomId}` }, (p) => this._onMsgChange('UPDATE', p.new, p.old))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tokens',   filter: `room_id=eq.${this.roomId}` }, (p) => this._fire('token_added', this._normToken(p.new)))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tokens',   filter: `room_id=eq.${this.roomId}` }, (p) => {
        const n = this._normToken(p.new);
        const o = p.old;
        if (o && (o.x !== n.x || o.y !== n.y) && o.name === n.name) {
          this._fire('token_moved', { token_id: n.id, x: n.x, y: n.y });
        } else {
          this._fire('token_updated', n);
        }
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'tokens',   filter: `room_id=eq.${this.roomId}` }, (p) => this._fire('token_removed', { token_id: p.old.id }))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pins',     filter: `room_id=eq.${this.roomId}` }, (p) => this._fire('pin_added', p.new))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'pins',     filter: `room_id=eq.${this.roomId}` }, (p) => this._fire('pin_updated', p.new))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'pins',     filter: `room_id=eq.${this.roomId}` }, (p) => this._fire('pin_removed', { pin_id: p.old.id }))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms',    filter: `id=eq.${this.roomId}` },    (p) => this._onRoomChange(p.new, p.old))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'library',  filter: `room_id=eq.${this.roomId}` }, (p) => this._fire('library_item_created', this._normLib(p.new)))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'library',  filter: `room_id=eq.${this.roomId}` }, (p) => {
        const n = this._normLib(p.new);
        const o = p.old;
        if (o && o.name !== n.name) this._fire('library_item_renamed', { id: n.id, name: n.name });
        if (o && o.content !== n.content) this._fire('library_item_updated', { id: n.id, content: n.content });
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'library',  filter: `room_id=eq.${this.roomId}` }, (p) => this._fire('library_item_deleted', { deletedIds: [p.old.id] }))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'presets',  filter: `room_id=eq.${this.roomId}` }, () => this._refreshPresets())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'presets',  filter: `room_id=eq.${this.roomId}` }, () => this._refreshPresets())
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'presets',  filter: `room_id=eq.${this.roomId}` }, () => this._refreshPresets())
      .on('postgres_changes', { event: '*',      schema: 'public', table: 'player_sheets', filter: `room_id=eq.${this.roomId}` }, (p) => this._onSheetChange(p))
      .on('postgres_changes', { event: '*',      schema: 'public', table: 'templates' }, () => this._refreshTemplates())
      .subscribe(async (status) => {
        if (status !== 'SUBSCRIBED') return;
        // Lê nível salvo do banco antes de rastrear presença
        const { data: myRow } = await db.from('player_sheets').select('vitals').eq('room_id', this.roomId).eq('session_id', this.id).single();
        if (myRow?.vitals?.level !== undefined) this._myLevel = myRow.vitals.level;
        if (myRow?.vitals?.bonus_level !== undefined) this._myBonus = myRow.vitals.bonus_level;
        await this._ch.track({
          name: this.playerName, is_gm: this.isGM, token: this.id,
          vitals: this._myVitals, level: this._myLevel, bonus_level: this._myBonus
        });
        this._fire('connect');
      });
  }

  // ── Sincronizar lista de jogadores da Presença ──────────────────────────
  _syncPlayers() {
    const state = this._ch.presenceState();
    const players = {};
    for (const [key, entries] of Object.entries(state)) {
      const e = entries[0];
      if (!e) continue;
      players[e.token || key] = {
        name: e.name, is_gm: e.is_gm, token: e.token || key, online: true,
        vitals: e.vitals || {}, level: e.level || 0, bonus_level: e.bonus_level || 0,
      };
    }
    this._fire('player_list', players);
  }

  // ── Normalização de tipos ───────────────────────────────────────────────
  _normToken(row) {
    return {
      id: row.id, name: row.name, x: row.x, y: row.y,
      hp: row.hp, hp_max: row.hp_max, size: row.size,
      hidden: row.hidden, color: row.color, shape: row.shape,
      image: row.avatar_url || null,
    };
  }
  _normLib(row) {
    return { id: row.id, parentId: row.parent_id, type: row.type, name: row.name, content: row.content || '' };
  }
  _normMsg(row) {
    return {
      id: row.id, type: row.type || 'chat', author: row.author,
      target: row.target, text: row.text,
      rolls: row.rolls, total: row.total,
      filedata: row.image_url || row.file_url, filename: row.file_name,
      filetype: row.file_name ? (row.image_url ? 'image/jpeg' : 'application/octet-stream') : null,
      category: row.category, persona: row.persona,
      deleted: row.deleted, deletedBy: row.deleted_by,
      edited: row.edited, realAuthor: row.author,
      created_at: row.created_at,
    };
  }

  // ── Eventos de mensagem ─────────────────────────────────────────────────
  _onMsgChange(op, row, old) {
    if (op === 'INSERT') {
      if (this._pendingMsgIds.has(row.id)) { this._pendingMsgIds.delete(row.id); return; }
      const msg = this._normMsg(row);
      // Filtrar whispers — só ver se for autor, destinatário ou GM
      if (msg.type === 'whisper') {
        const myName = this.playerName;
        const isTarget = msg.target && msg.target.toLowerCase() === myName.toLowerCase();
        if (!this.isGM && msg.author !== myName && !isTarget) return;
      }
      this._fire('new_message', msg);
    } else if (op === 'UPDATE') {
      if (row.deleted && !old?.deleted) {
        this._fire('message_deleted', { msg_id: row.id, deletedBy: row.deleted_by });
      } else if (row.text !== old?.text) {
        this._fire('message_edited', { msg_id: row.id, text: row.text, editCount: (row.edits || []).length });
      }
    }
  }

  // ── Evento de mudança na sala (map, notes, template) ────────────────────
  _onRoomChange(newRow, oldRow) {
    if (JSON.stringify(newRow.map) !== JSON.stringify(oldRow?.map)) {
      this._fire('map_updated', newRow.map || {});
    }
    if (newRow.notes !== oldRow?.notes) {
      this._fire('notes_updated', { notes: newRow.notes || '' });
    }
    if (newRow.active_template_id !== oldRow?.active_template_id) {
      this._db.from('templates').select('*').eq('id', newRow.active_template_id).single().then(({ data }) => {
        if (data) this._fire('room_template_changed', { template_id: data.id, template: data.data });
      });
    }
  }

  // ── Mudança de ficha de jogador ─────────────────────────────────────────
  _onSheetChange(p) {
    const row = p.new || p.old;
    if (!row) return;
    if (row.session_id === this.id) {
      // Minha ficha mudou (GM editou) → atualizo localStorage e presença
      if (row.sheet) localStorage.setItem('rpg_sheet_v2', JSON.stringify(row.sheet));
      if (row.vitals) {
        this._myVitals = row.vitals;
        if (row.vitals.level !== undefined) this._myLevel = row.vitals.level;
        if (row.vitals.bonus_level !== undefined) this._myBonus = row.vitals.bonus_level;
        this._ch.track({ ...this._getMyPresence(), vitals: row.vitals });
      }
      this._fire('my_sheet_updated', { sheet: row.sheet });
    } else {
      // Ficha de outro jogador mudou — propaga nível se presente
      if (row.vitals && (row.vitals.level !== undefined || row.vitals.bonus_level !== undefined)) {
        this._fire('player_level_updated', {
          sid: row.session_id,
          level: row.vitals.level || 0,
          bonus_level: row.vitals.bonus_level || 0,
        });
      }
    }
  }

  _getMyPresence() {
    return { name: this.playerName, is_gm: this.isGM, token: this.id, vitals: this._myVitals, level: this._myLevel, bonus_level: this._myBonus };
  }

  // ── Refresh presets ─────────────────────────────────────────────────────
  async _refreshPresets() {
    if (!this.isGM) return;
    const { data } = await this._db.from('presets').select('id,name').eq('room_id', this.roomId);
    this._fire('presets_updated', { presets: data || [] });
  }

  // ── Refresh templates ───────────────────────────────────────────────────
  async _refreshTemplates() {
    const { data } = await this._db.from('templates').select('id,name,builtin');
    this._fire('templates_updated', { all_templates: data || [] });
  }

  // ── Roteamento de emits ─────────────────────────────────────────────────
  async _route(event, data) {
    const db = this._db;
    const rid = this.roomId;

    switch (event) {
      // ── JOIN / LEAVE ──
      case 'join':
        // Presença já foi rastreada em connect()
        await this._loadRoomState();
        return;
      case 'leave_room':
        await this._ch?.untrack();
        return;

      // ── CHAT ──
      case 'chat_message': {
        const id = this._uid();
        this._pendingMsgIds.add(id);
        const row = {
          id, room_id: rid, type: data.chat_type || 'chat',
          author: data.persona || this.playerName,
          target: data.target || null,
          text: data.text || '',
          persona: data.chat_type === 'persona' ? (data.persona || null) : null,
        };
        // Para highlight, mantenha o autor original
        if (data.origAuthor) row.text = data.text;
        const msgToFire = { ...row, realAuthor: this.playerName };
        this._fire('new_message', msgToFire); // eco local imediato
        await db.from('messages').insert(row);
        return;
      }
      case 'file_message': {
        const id = this._uid();
        this._pendingMsgIds.add(id);
        const isImg = (data.filetype || '').startsWith('image/');
        const row = {
          id, room_id: rid, type: 'file',
          author: this.playerName,
          image_url: isImg ? data.filedata : null,
          file_url: !isImg ? data.filedata : null,
          file_name: data.filename,
          category: data.category || 'none',
        };
        const msgToFire = { ...row, filedata: data.filedata, filename: data.filename, filetype: data.filetype, realAuthor: this.playerName };
        this._fire('new_message', msgToFire);
        await db.from('messages').insert(row);
        return;
      }
      case 'delete_message':
        await db.from('messages').update({ deleted: true, deleted_by: this.playerName, deleted_at: new Date().toISOString() }).eq('id', data.msg_id);
        return;
      case 'edit_message': {
        const { data: cur } = await db.from('messages').select('text,edits').eq('id', data.msg_id).single();
        const edits = [...(cur?.edits || []), { text: cur?.text, at: new Date().toISOString() }];
        await db.from('messages').update({ text: data.text, edited: true, edits }).eq('id', data.msg_id);
        return;
      }
      case 'clear_chat':
        await this._ch.send({ type: 'broadcast', event: 'chat_cleared', payload: {} });
        await db.from('messages').update({ deleted: true, deleted_by: this.playerName }).eq('room_id', rid).eq('deleted', false);
        return;

      // ── DADOS ──
      case 'roll_dice': {
        const { sides = 20, dice = sides, count = 1, modifier = 0 } = data;
        const faces = dice || sides;
        const rolls = Array.from({ length: count }, () => Math.floor(Math.random() * faces) + 1);
        const base = rolls.reduce((s, r) => s + r, 0);
        const total = base + modifier;
        const rollsStr = rolls.join(', ');
        const modStr = modifier !== 0 ? (modifier > 0 ? ` + ${modifier}` : ` - ${Math.abs(modifier)}`) : '';
        const text = count === 1
          ? `rolou **${total}** no d${faces}${modifier !== 0 ? ` (${rollsStr}${modStr})` : ''}`
          : `rolou **${total}** em ${count}d${faces} [${rollsStr}]${modStr}`;
        const id = this._uid();
        this._pendingMsgIds.add(id);
        const msg = { id, room_id: rid, type: 'roll', author: this.playerName, text, rolls, total };
        this._fire('new_message', { ...msg, realAuthor: this.playerName });
        await db.from('messages').insert(msg);
        return;
      }
      case 'attr_roll': {
        const { label, value, dice = 12 } = data;
        const roll = Math.floor(Math.random() * dice) + 1;
        const total = roll + (value || 0);
        const success = total >= dice;
        const text = `testou **${label}** — rolou ${roll} + ${value || 0} = **${total}** no D${dice} → ${success ? '✅ Sucesso' : '❌ Falha'}`;
        const id = this._uid();
        this._pendingMsgIds.add(id);
        const msg = { id, room_id: rid, type: 'roll', author: this.playerName, text, rolls: [roll], total };
        this._fire('new_message', { ...msg, realAuthor: this.playerName });
        await db.from('messages').insert(msg);
        return;
      }

      // ── NOTAS ──
      case 'notes_update':
        await db.from('rooms').update({ notes: data.notes }).eq('id', rid);
        return;

      // ── BIBLIOTECA ──
      case 'library_create': {
        const id = this._uid();
        const row = { id, room_id: rid, parent_id: data.parentId || null, type: data.type, name: data.type === 'folder' ? 'Nova pasta' : 'Nova página', content: '' };
        await db.from('library').insert(row);
        return;
      }
      case 'library_rename':
        await db.from('library').update({ name: data.name }).eq('id', data.id);
        return;
      case 'library_delete': {
        // Deleta recursivamente
        const toDelete = await this._libCollectIds(data.id);
        if (toDelete.length > 0) {
          await db.from('library').delete().in('id', toDelete);
          this._fire('library_item_deleted', { deletedIds: toDelete });
        }
        return;
      }
      case 'library_update_content':
        await db.from('library').update({ content: data.content }).eq('id', data.id);
        return;

      // ── TOKENS ──
      case 'token_add': {
        const t = data.token;
        await db.from('tokens').insert({
          id: t.id, room_id: rid, x: t.x, y: t.y, name: t.name,
          hp: t.hp || 0, hp_max: t.hp_max || 0, size: t.size || 1,
          hidden: t.hidden || false, avatar_url: t.image || null,
          color: t.color || '#e94560', shape: t.shape || 'circle',
        });
        return;
      }
      case 'token_move':
        await db.from('tokens').update({ x: data.x, y: data.y }).eq('id', data.token_id);
        return;
      case 'token_remove':
        await db.from('tokens').delete().eq('id', data.token_id);
        return;
      case 'token_update': {
        const t = data.token;
        await db.from('tokens').update({
          name: t.name, hp: t.hp, hp_max: t.hp_max, size: t.size,
          hidden: t.hidden, color: t.color, avatar_url: t.image || null,
        }).eq('id', t.id);
        return;
      }

      // ── MAPA ──
      case 'map_update': {
        // Merge parcial do JSONB
        const { data: cur } = await db.from('rooms').select('map').eq('id', rid).single();
        const merged = { ...(cur?.map || {}), ...data.map };
        await db.from('rooms').update({ map: merged }).eq('id', rid);
        return;
      }

      // ── PINS ──
      case 'pin_add':
        await db.from('pins').insert({ ...data.pin, room_id: rid });
        return;
      case 'pin_update':
        await db.from('pins').update({ label: data.pin.label, hidden: data.pin.hidden, x: data.pin.x, y: data.pin.y }).eq('id', data.pin.id);
        return;
      case 'pin_remove':
        await db.from('pins').delete().eq('id', data.pin_id);
        return;

      // ── PRESETS ──
      case 'save_preset': {
        const mapSnap = data.map || {};
        const tokSnap = data.tokens || {};
        const pinSnap = data.pins || {};
        await db.from('presets').insert({ id: this._uid(), room_id: rid, name: data.name, data: { map: mapSnap, tokens: tokSnap, pins: pinSnap } });
        return;
      }
      case 'load_preset': {
        const { data: preset } = await db.from('presets').select('data').eq('id', data.preset_id).single();
        if (preset?.data) {
          // Limpar tokens e pins atuais
          await db.from('tokens').delete().eq('room_id', rid);
          await db.from('pins').delete().eq('room_id', rid);
          const pd = preset.data;
          if (pd.map) await db.from('rooms').update({ map: pd.map }).eq('id', rid);
          const toks = Object.values(pd.tokens || {});
          if (toks.length > 0) await db.from('tokens').insert(toks.map(t => ({ ...t, room_id: rid, avatar_url: t.image || null })));
          const pinArr = Object.values(pd.pins || {});
          if (pinArr.length > 0) await db.from('pins').insert(pinArr.map(p => ({ ...p, room_id: rid })));
          this._fire('preset_loaded', pd);
        }
        return;
      }
      case 'delete_preset':
        await db.from('presets').delete().eq('id', data.preset_id);
        return;
      case 'rename_preset':
        await db.from('presets').update({ name: data.name }).eq('id', data.preset_id);
        return;

      // ── FICHAS DE JOGADOR ──
      case 'share_sheet': {
        const vitals = this._extractVitals(data.sheet);
        this._myVitals = vitals;
        await db.from('player_sheets').upsert({
          room_id: rid, session_id: this.id, player_name: this.playerName,
          sheet: data.sheet, vitals,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'room_id,session_id' });
        // Atualiza presença com novos vitais
        await this._ch?.track({ ...this._getMyPresence(), vitals });
        return;
      }
      case 'request_player_sheet': {
        const { data: row } = await db.from('player_sheets').select('*').eq('room_id', rid).eq('session_id', data.target_sid).single();
        this._fire('player_sheet_data', { sid: data.target_sid, playerName: row?.player_name || data.target_name || '', sheet: row?.sheet || {} });
        return;
      }
      case 'gm_update_sheet': {
        const vitals = this._extractVitals(data.sheet);
        const { error } = await db.from('player_sheets').upsert({
          room_id: rid, session_id: data.target_sid,
          sheet: data.sheet, vitals,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'room_id,session_id' });
        return error ? { error: error.message } : { ok: true };
      }
      case 'update_vitals': {
        const { data: row } = await db.from('player_sheets').select('vitals').eq('room_id', rid).eq('session_id', data.target_sid).single();
        const merged = { ...(row?.vitals || {}), ...data.vitals };
        await db.from('player_sheets').update({ vitals: merged }).eq('room_id', rid).eq('session_id', data.target_sid);
        // Atualiza presença se for o próprio jogador
        if (data.target_sid === this.id) {
          this._myVitals = merged;
          await this._ch?.track({ ...this._getMyPresence(), vitals: merged });
        }
        this._fire('player_vitals_updated', { sid: data.target_sid, vitals: merged });
        return;
      }
      case 'update_level': {
        if (data.target_sid === this.id) {
          this._myLevel = data.level;
          this._myBonus = data.bonus_level;
          await this._ch?.track({ ...this._getMyPresence(), level: data.level, bonus_level: data.bonus_level });
        } else {
          // GM atualizou outro jogador — merge com vitais existentes (não sobrescreve vida/san/ene)
          const { data: row } = await db.from('player_sheets').select('vitals').eq('room_id', rid).eq('session_id', data.target_sid).single();
          const mergedVitals = { ...(row?.vitals || {}), level: data.level, bonus_level: data.bonus_level };
          await db.from('player_sheets').upsert({
            room_id: rid, session_id: data.target_sid,
            vitals: mergedVitals,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'room_id,session_id' });
        }
        this._fire('player_level_updated', { sid: data.target_sid, level: data.level, bonus_level: data.bonus_level });
        return;
      }

      // ── TEMPLATES ──
      case 'get_templates': {
        const { data: tpls } = await db.from('templates').select('*');
        const all = (tpls || []).map(t => ({ id: t.id, name: t.name, builtin: t.builtin }));
        const templatesMap = {};
        for (const t of (tpls || [])) templatesMap[t.id] = { ...t.data, id: t.id, name: t.name, builtin: t.builtin };
        const { data: room } = await db.from('rooms').select('active_template_id').eq('id', rid).single();
        return { all_templates: all, templates: templatesMap, active_template_id: room?.active_template_id };
      }
      case 'save_template': {
        const { template: tpl } = data;
        const { id, name, builtin, ...rest } = tpl;
        await db.from('templates').upsert({ id, name, builtin: builtin || false, data: rest }, { onConflict: 'id' });
        const { data: tpls } = await db.from('templates').select('id,name,builtin');
        return { ok: true, all_templates: tpls || [] };
      }
      case 'set_room_template': {
        await db.from('rooms').update({ active_template_id: data.template_id }).eq('id', rid);
        const { data: tplRow } = await db.from('templates').select('*').eq('id', data.template_id).single();
        if (!tplRow) return { error: 'Template não encontrado' };
        const template = { ...tplRow.data, id: tplRow.id, name: tplRow.name, builtin: tplRow.builtin };
        return { ok: true, template };
      }
      case 'delete_template':
        if (data.template_id === 'terror-sobrenatural') return { error: 'Não pode excluir o template padrão.' };
        await db.from('templates').delete().eq('id', data.template_id);
        const { data: tpls2 } = await db.from('templates').select('id,name,builtin');
        return { ok: true, all_templates: tpls2 || [] };

      default:
        console.warn('[shim] evento não tratado:', event);
        return null;
    }
  }

  // ── Carrega estado inicial da sala ──────────────────────────────────────
  async _loadRoomState() {
    const db = this._db;
    const rid = this.roomId;

    const [msgRes, tokRes, pinRes, roomRes, libRes, presetRes, tplRes, mySheetRes] = await Promise.all([
      db.from('messages').select('*').eq('room_id', rid).eq('deleted', false).order('created_at', { ascending: true }).limit(150),
      db.from('tokens').select('*').eq('room_id', rid),
      db.from('pins').select('*').eq('room_id', rid),
      db.from('rooms').select('*').eq('id', rid).single(),
      db.from('library').select('*').eq('room_id', rid),
      db.from('presets').select('id,name').eq('room_id', rid),
      db.from('templates').select('*'),
      db.from('player_sheets').select('*').eq('room_id', rid).eq('session_id', this.id).single(),
    ]);

    const room = roomRes.data || {};
    const tpls = tplRes.data || [];
    const allTemplates = tpls.map(t => ({ id: t.id, name: t.name, builtin: t.builtin }));

    // Template ativo
    const activeTplId = room.active_template_id || 'terror-sobrenatural';
    const activeTpl = tpls.find(t => t.id === activeTplId);
    const template = activeTpl ? { ...activeTpl.data, id: activeTpl.id, name: activeTpl.name, builtin: activeTpl.builtin } : null;

    // Biblioteca: converter lista para map por id
    const library = {};
    for (const item of (libRes.data || [])) library[item.id] = this._normLib(item);

    // Tokens map
    const tokenMap = {};
    for (const t of (tokRes.data || [])) tokenMap[t.id] = this._normToken(t);

    // Pins map
    const pinsMap = {};
    for (const p of (pinRes.data || [])) pinsMap[p.id] = p;

    // Mensagens
    const messages = (msgRes.data || []).map(m => this._normMsg(m));

    // Minha ficha salva
    if (mySheetRes.data) {
      const savedSheet = mySheetRes.data.sheet;
      if (savedSheet) localStorage.setItem('rpg_sheet_v2', JSON.stringify(savedSheet));
      if (mySheetRes.data.vitals) this._myVitals = mySheetRes.data.vitals;
    }

    this._fire('room_state', {
      messages,
      map: room.map || null,
      tokens: tokenMap,
      pins: pinsMap,
      notes: room.notes || '',
      library,
      presets: presetRes.data || [],
      all_templates: allTemplates,
      active_template_id: activeTplId,
      template,
    });

    // Compartilhar ficha automaticamente se não está no GM e tiver ficha salva
    if (!this.isGM) {
      const raw = localStorage.getItem('rpg_sheet_v2');
      if (raw) {
        try {
          const sheet = JSON.parse(raw);
          const vitals = this._extractVitals(sheet);
          this._myVitals = vitals;
          await db.from('player_sheets').upsert({
            room_id: rid, session_id: this.id, player_name: this.playerName,
            sheet, vitals, updated_at: new Date().toISOString(),
          }, { onConflict: 'room_id,session_id' });
          await this._ch?.track({ ...this._getMyPresence(), vitals });
        } catch(e) {}
      }
    }
  }

  // ── Auxiliares ──────────────────────────────────────────────────────────
  _uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  _extractVitals(sheet) {
    if (!sheet) return {};
    const vitals = {};
    // Recursos dinâmicos (novo formato)
    if (sheet.resources) {
      for (const [key, val] of Object.entries(sheet.resources)) vitals[key] = parseInt(val) || 0;
    }
    // Fallback formato antigo
    if (sheet.vida !== undefined) vitals.vida = parseInt(sheet.vida) || 0;
    if (sheet['vida-max'] !== undefined) vitals.vida_max = parseInt(sheet['vida-max']) || 0;
    if (sheet.sanidade !== undefined) vitals.sanidade = parseInt(sheet.sanidade) || 0;
    if (sheet['sanidade-max'] !== undefined) vitals.sanidade_max = parseInt(sheet['sanidade-max']) || 0;
    if (sheet.energia !== undefined) vitals.energia = parseInt(sheet.energia) || 0;
    if (sheet['energia-max'] !== undefined) vitals.energia_max = parseInt(sheet['energia-max']) || 0;
    if (sheet.name) vitals.char_name = sheet.name;
    if (sheet.avatar) vitals.avatar = sheet.avatar;
    return vitals;
  }

  async _libCollectIds(rootId) {
    const db = this._db;
    const { data: all } = await db.from('library').select('id,parent_id').eq('room_id', this.roomId);
    const items = all || [];
    const result = [];
    const queue = [rootId];
    while (queue.length) {
      const cur = queue.shift();
      result.push(cur);
      for (const it of items) { if (it.parent_id === cur) queue.push(it.id); }
    }
    return result;
  }
}

window.SocketShim = SocketShim;
