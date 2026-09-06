-- Tabela de sessão do connect-pg-simple (DDL padrão). Criada no schema
-- corrente via search_path — sem qualificar.
CREATE TABLE IF NOT EXISTS session (
  sid    VARCHAR NOT NULL COLLATE "default",
  sess   JSONB NOT NULL,
  expire TIMESTAMPTZ(6) NOT NULL
);
ALTER TABLE session
  ADD CONSTRAINT session_pkey PRIMARY KEY (sid) NOT DEFERRABLE INITIALLY IMMEDIATE;
CREATE INDEX IF NOT EXISTS IDX_session_expire ON session (expire);
