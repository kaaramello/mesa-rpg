from flask import Flask, render_template, request
from flask_socketio import SocketIO, join_room, leave_room, emit
import random
import string
import json
import os

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'rpg-mesa-secret-2024')
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet')

# Estado das salas: {room_id: {players, map_state, tokens, messages}}
rooms = {}

def generate_room_id():
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))

def get_or_create_room(room_id):
    if room_id not in rooms:
        rooms[room_id] = {
            'players': {},
            'tokens': {},
            'messages': [],
            'map': {
                'background': None,
                'grid_size': 50,
                'show_grid': True,
                'width': 3000,
                'height': 2000,
            }
        }
    return rooms[room_id]

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/room/<room_id>')
def room(room_id):
    return render_template('room.html', room_id=room_id)

def get_client_ip():
    forwarded = request.environ.get('HTTP_X_FORWARDED_FOR')
    if forwarded:
        return forwarded.split(',')[0].strip()
    return request.environ.get('REMOTE_ADDR', '0.0.0.0')

def _broadcast_players(room_id, room):
    """Envia a lista COMPLETA de jogadores para cada cliente na sala."""
    full_list = {
        s: {'name': p['name'], 'is_gm': p['is_gm'], 'vitals': p.get('vitals', {})}
        for s, p in room['players'].items()
    }
    socketio.emit('player_list', full_list, to=room_id)

@socketio.on('join')
def on_join(data):
    room_id = data['room_id']
    player_name = data['player_name']
    is_gm = data.get('is_gm', False)
    sid = request.sid
    client_ip = get_client_ip()

    room = get_or_create_room(room_id)
    player_token = data.get('token', sid)

    # Remove sessão anterior do mesmo token (reconexão/outra aba)
    old_sid = None
    for existing_sid, p in list(room['players'].items()):
        if p.get('token') == player_token and existing_sid != sid:
            old_sid = existing_sid
            break

    if old_sid:
        emit('kicked', {'reason': 'Nova sessão iniciada.'}, to=old_sid)
        del room['players'][old_sid]
        try:
            socketio.disconnect(old_sid)
        except Exception:
            pass

    # Registra e entra na sala
    join_room(room_id)
    room['players'][sid] = {
        'name': player_name,
        'is_gm': is_gm,
        'sid': sid,
        'ip': client_ip,
        'token': player_token
    }

    # Estado inicial apenas para o novo jogador
    emit('room_state', {
        'tokens': room['tokens'],
        'messages': room['messages'][-50:],
        'map': room['map'],
    })

    # Transmite lista completa para TODOS (resolve duplicatas na origem)
    _broadcast_players(room_id, room)

    system_msg = {'type': 'system', 'text': f'{player_name} entrou na sala.', 'id': _msg_id()}
    room['messages'].append(system_msg)
    emit('new_message', system_msg, to=room_id)

@socketio.on('disconnect')
def on_disconnect():
    sid = request.sid
    for room_id, room in rooms.items():
        if sid in room['players']:
            name = room['players'][sid]['name']
            del room['players'][sid]
            leave_room(room_id)
            msg = {'type': 'system', 'text': f'{name} saiu da sala.', 'id': _msg_id()}
            room['messages'].append(msg)
            emit('new_message', msg, to=room_id)
            # Transmite lista atualizada para todos
            _broadcast_players(room_id, room)
            break

@socketio.on('chat_message')
def on_chat_message(data):
    room_id = data['room_id']
    room = get_or_create_room(room_id)
    sid = request.sid
    player = room['players'].get(sid, {'name': 'Desconhecido'})
    msg = {
        'type': 'chat',
        'author': player['name'],
        'text': data['text'],
        'id': _msg_id()
    }
    room['messages'].append(msg)
    emit('new_message', msg, to=room_id)

@socketio.on('roll_dice')
def on_roll_dice(data):
    room_id = data['room_id']
    room = get_or_create_room(room_id)
    sid = request.sid
    player = room['players'].get(sid, {'name': 'Desconhecido'})

    dice_type = data['dice']  # e.g. 20
    modifier = int(data.get('modifier', 0))
    count = int(data.get('count', 1))

    rolls = [random.randint(1, dice_type) for _ in range(count)]
    total = sum(rolls) + modifier

    mod_str = f' + {modifier}' if modifier > 0 else (f' - {abs(modifier)}' if modifier < 0 else '')
    rolls_str = ' + '.join(str(r) for r in rolls) if len(rolls) > 1 else str(rolls[0])
    detail = f'[{rolls_str}]{mod_str} = **{total}**' if (len(rolls) > 1 or modifier != 0) else f'**{total}**'

    msg = {
        'type': 'roll',
        'author': player['name'],
        'text': f'rolou {count}d{dice_type}{mod_str}: {detail}',
        'rolls': rolls,
        'total': total,
        'id': _msg_id()
    }
    room['messages'].append(msg)
    emit('new_message', msg, to=room_id)

@socketio.on('token_add')
def on_token_add(data):
    room_id = data['room_id']
    room = get_or_create_room(room_id)
    token_id = data['token']['id']
    room['tokens'][token_id] = data['token']
    emit('token_added', data['token'], to=room_id)

@socketio.on('token_move')
def on_token_move(data):
    room_id = data['room_id']
    room = get_or_create_room(room_id)
    token_id = data['token_id']
    if token_id in room['tokens']:
        room['tokens'][token_id]['x'] = data['x']
        room['tokens'][token_id]['y'] = data['y']
    emit('token_moved', {'token_id': token_id, 'x': data['x'], 'y': data['y']}, to=room_id)

@socketio.on('token_remove')
def on_token_remove(data):
    room_id = data['room_id']
    room = get_or_create_room(room_id)
    token_id = data['token_id']
    if token_id in room['tokens']:
        del room['tokens'][token_id]
    emit('token_removed', {'token_id': token_id}, to=room_id)

@socketio.on('token_update')
def on_token_update(data):
    room_id = data['room_id']
    room = get_or_create_room(room_id)
    token_id = data['token']['id']
    if token_id in room['tokens']:
        room['tokens'][token_id].update(data['token'])
    emit('token_updated', data['token'], to=room_id)

@socketio.on('map_update')
def on_map_update(data):
    room_id = data['room_id']
    room = get_or_create_room(room_id)
    room['map'].update(data['map'])
    emit('map_updated', data['map'], to=room_id)

@socketio.on('share_sheet')
def on_share_sheet(data):
    room_id = data['room_id']
    room = get_or_create_room(room_id)
    sid = request.sid
    sheet = data.get('sheet', {})
    if sid in room['players']:
        room['players'][sid]['sheet'] = sheet
    vitals = {
        'vida': sheet.get('vida', ''), 'vida_max': sheet.get('vida-max', ''),
        'sanidade': sheet.get('sanidade', ''), 'sanidade_max': sheet.get('sanidade-max', ''),
        'energia': sheet.get('energia', ''), 'energia_max': sheet.get('energia-max', ''),
        'avatar': sheet.get('avatar', None),
        'char_name': sheet.get('name', '')
    }
    if sid in room['players']:
        room['players'][sid]['vitals'] = vitals
    emit('player_vitals_updated', {'sid': sid, 'vitals': vitals}, to=room_id)
    _broadcast_players(room_id, room)

@socketio.on('request_player_sheet')
def on_request_player_sheet(data):
    room_id = data['room_id']
    room = get_or_create_room(room_id)
    sid = request.sid
    target_sid = data['target_sid']
    if room['players'].get(sid, {}).get('is_gm'):
        sheet = room['players'].get(target_sid, {}).get('sheet', {})
        emit('player_sheet_data', {'sid': target_sid, 'sheet': sheet}, to=sid)

@socketio.on('update_vitals')
def on_update_vitals(data):
    room_id = data['room_id']
    room = get_or_create_room(room_id)
    sid = request.sid
    target_sid = data.get('target_sid', sid)
    requester = room['players'].get(sid, {})
    if target_sid == sid or requester.get('is_gm'):
        vitals = data['vitals']
        if target_sid in room['players']:
            room['players'][target_sid]['vitals'] = vitals
        emit('player_vitals_updated', {'sid': target_sid, 'vitals': vitals}, to=room_id)
        _broadcast_players(room_id, room)

@socketio.on('file_message')
def on_file_message(data):
    room_id = data['room_id']
    room = get_or_create_room(room_id)
    sid = request.sid
    player = room['players'].get(sid, {'name': 'Desconhecido'})
    msg = {
        'type': 'file',
        'author': player['name'],
        'filename': data['filename'],
        'filetype': data['filetype'],
        'filedata': data['filedata'],
        'id': _msg_id()
    }
    emit('new_message', msg, to=room_id)

def _msg_id():
    return ''.join(random.choices(string.ascii_lowercase + string.digits, k=8))

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    print(f"=== Mesa RPG Digital — porta {port} ===")
    socketio.run(app, host='0.0.0.0', port=port, debug=False, allow_unsafe_werkzeug=True)
