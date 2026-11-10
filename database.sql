PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  nome_usuario TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  senha TEXT NOT NULL,
  tipo_usuario TEXT NOT NULL CHECK (tipo_usuario IN ('comum', 'fotografo')),
  foto_perfil TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS publicacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  id_fotografo INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  local_origem TEXT NOT NULL,
  caminho_imagem TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS ix_publicacoes_fotografo ON publicacoes(id_fotografo);

CREATE TABLE IF NOT EXISTS curtidas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  id_usuario INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  id_publicacao INTEGER NOT NULL REFERENCES publicacoes(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (id_usuario, id_publicacao)
);

CREATE INDEX IF NOT EXISTS ix_curtidas_publicacao ON curtidas(id_publicacao);

CREATE TABLE IF NOT EXISTS sessoes (
  token TEXT PRIMARY KEY,
  id_usuario INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  expira_em INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_sessoes_expiracao ON sessoes(expira_em);
