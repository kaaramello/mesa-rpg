-- ===================== MESA RPG DIGITAL — SCHEMA =====================

-- Salas
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  map JSONB DEFAULT '{"background":null,"grid_size":50,"show_grid":true,"width":3000,"height":2000,"grid_color":"#ffffff","grid_opacity":0.13,"grid_type":"square"}',
  notes TEXT DEFAULT '',
  active_template_id TEXT DEFAULT 'terror-sobrenatural',
  gm_token TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Mensagens do chat
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  room_id TEXT REFERENCES rooms(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'chat',
  author TEXT,
  target TEXT,
  text TEXT,
  rolls JSONB,
  total INTEGER,
  image_url TEXT,
  file_url TEXT,
  file_name TEXT,
  category TEXT,
  persona TEXT,
  deleted BOOLEAN DEFAULT FALSE,
  deleted_by TEXT,
  deleted_at TIMESTAMPTZ,
  edited BOOLEAN DEFAULT FALSE,
  edits JSONB DEFAULT '[]',
  pinned BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_id, created_at);

-- Tokens do mapa
CREATE TABLE IF NOT EXISTS tokens (
  id TEXT PRIMARY KEY,
  room_id TEXT REFERENCES rooms(id) ON DELETE CASCADE,
  x FLOAT DEFAULT 0,
  y FLOAT DEFAULT 0,
  name TEXT DEFAULT '',
  hp INTEGER DEFAULT 0,
  hp_max INTEGER DEFAULT 0,
  size INTEGER DEFAULT 1,
  hidden BOOLEAN DEFAULT FALSE,
  avatar_url TEXT,
  color TEXT DEFAULT '#e94560',
  shape TEXT DEFAULT 'circle'
);
CREATE INDEX IF NOT EXISTS idx_tokens_room ON tokens(room_id);

-- Pins do mapa
CREATE TABLE IF NOT EXISTS pins (
  id TEXT PRIMARY KEY,
  room_id TEXT REFERENCES rooms(id) ON DELETE CASCADE,
  x FLOAT DEFAULT 0,
  y FLOAT DEFAULT 0,
  label TEXT DEFAULT '',
  hidden BOOLEAN DEFAULT FALSE
);

-- Presets de mapa
CREATE TABLE IF NOT EXISTS presets (
  id TEXT PRIMARY KEY,
  room_id TEXT REFERENCES rooms(id) ON DELETE CASCADE,
  name TEXT,
  data JSONB
);

-- Biblioteca de mídia
CREATE TABLE IF NOT EXISTS library (
  id TEXT PRIMARY KEY,
  room_id TEXT REFERENCES rooms(id) ON DELETE CASCADE,
  parent_id TEXT,
  type TEXT DEFAULT 'folder',
  name TEXT,
  content TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_library_room ON library(room_id);

-- Fichas dos jogadores (por sessão)
CREATE TABLE IF NOT EXISTS player_sheets (
  id TEXT DEFAULT gen_random_uuid()::text,
  room_id TEXT REFERENCES rooms(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  player_name TEXT,
  sheet JSONB DEFAULT '{}',
  vitals JSONB DEFAULT '{}',
  bonus_level INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (room_id, session_id)
);

-- Templates de ficha (globais)
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  name TEXT,
  builtin BOOLEAN DEFAULT FALSE,
  data JSONB
);

-- ===================== REALTIME =====================
-- Habilitar realtime nas tabelas (rodar no SQL Editor)
ALTER TABLE messages REPLICA IDENTITY FULL;
ALTER TABLE tokens REPLICA IDENTITY FULL;
ALTER TABLE pins REPLICA IDENTITY FULL;
ALTER TABLE rooms REPLICA IDENTITY FULL;
ALTER TABLE player_sheets REPLICA IDENTITY FULL;
ALTER TABLE library REPLICA IDENTITY FULL;
ALTER TABLE presets REPLICA IDENTITY FULL;

-- ===================== RLS (desabilitado para simplicidade) =====================
ALTER TABLE rooms DISABLE ROW LEVEL SECURITY;
ALTER TABLE messages DISABLE ROW LEVEL SECURITY;
ALTER TABLE tokens DISABLE ROW LEVEL SECURITY;
ALTER TABLE pins DISABLE ROW LEVEL SECURITY;
ALTER TABLE presets DISABLE ROW LEVEL SECURITY;
ALTER TABLE library DISABLE ROW LEVEL SECURITY;
ALTER TABLE player_sheets DISABLE ROW LEVEL SECURITY;
ALTER TABLE templates DISABLE ROW LEVEL SECURITY;

-- ===================== TEMPLATE PADRÃO =====================
INSERT INTO templates (id, name, builtin, data) VALUES (
  'terror-sobrenatural',
  'Terror Sobrenatural',
  true,
  '{
    "classes": [
      {"id":"sensitivo","label":"Sensitivo","icon":"👁️"},
      {"id":"possuido","label":"Possuído","icon":"😈"},
      {"id":"feiticeiro","label":"Feiticeiro","icon":"🔮"},
      {"id":"santificado","label":"Santificado","icon":"✝️"}
    ],
    "resources": [
      {"id":"vida","label":"VIDA","icon":"❤️","max":10,"color":"#e94560"},
      {"id":"sanidade","label":"SANIDADE","icon":"🧠","max":10,"color":"#7c6af7"},
      {"id":"energia","label":"ENERGIA","icon":"⚡","max":10,"color":"#f59e0b"}
    ],
    "attrs": [
      {"id":"forca","label":"FORÇA","icon":"👊"},
      {"id":"agilidade","label":"AGILIDADE","icon":"🏃"},
      {"id":"defesa","label":"DEFESA","icon":"🛡️"},
      {"id":"inteligencia","label":"INTELIGÊNCIA","icon":"🧠"},
      {"id":"mental","label":"MENTAL","icon":"🧿"},
      {"id":"labia","label":"LÁBIA","icon":"💬"},
      {"id":"furtividade","label":"FURTIVIDADE","icon":"🌑"}
    ],
    "pericias": [
      {"id":"investigacao","label":"INVESTIGAÇÃO","icon":"🔍"},
      {"id":"sobrevivencia","label":"SOBREVIVÊNCIA","icon":"🎒"},
      {"id":"ocultismo","label":"OCULTISMO","icon":"🔮"},
      {"id":"religiao","label":"RELIGIÃO","icon":"✝️"},
      {"id":"intuicao","label":"INTUIÇÃO","icon":"👁️"},
      {"id":"medicina","label":"MEDICINA","icon":"🩺"}
    ],
    "tabs": ["perfil","status","inventario","habilidades","historia"]
  }'
) ON CONFLICT (id) DO NOTHING;
