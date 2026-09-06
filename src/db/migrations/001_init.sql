-- ============ USUÁRIOS (admin / barbeiros) ============
CREATE TABLE usuarios (
  id             INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nome           VARCHAR(100) NOT NULL,
  email          VARCHAR(100) NOT NULL UNIQUE,
  senha_hash     VARCHAR(255) NOT NULL,
  telefone       VARCHAR(20),
  role           VARCHAR(20) NOT NULL DEFAULT 'barbeiro'
                 CHECK (role IN ('admin','barbeiro')),
  ativo          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ CLIENTES ============
CREATE TABLE clientes (
  id                   INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nome                 VARCHAR(100) NOT NULL,
  celular              VARCHAR(20) NOT NULL UNIQUE,   -- só dígitos, normalizado
  email                VARCHAR(100),
  senha_hash           VARCHAR(255),                  -- NULL = cadastro simples
  celular_verificado   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  ultimo_agendamento   DATE
);

-- ============ SERVIÇOS ============
CREATE TABLE servicos (
  id                    INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nome                  VARCHAR(100) NOT NULL,
  duracao_minutos       INT NOT NULL DEFAULT 35,
  preco                 NUMERIC(10,2) NOT NULL,
  comissao_percentual   NUMERIC(5,2) NOT NULL DEFAULT 0,
  ativo                 BOOLEAN NOT NULL DEFAULT TRUE
);

-- ============ CONFIGURAÇÃO (linha única) ============
CREATE TABLE configuracao (
  id                      INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  nome_barbearia          VARCHAR(120) NOT NULL DEFAULT 'Minha Barbearia',
  endereco                TEXT,
  latitude                NUMERIC(10,7),
  longitude               NUMERIC(10,7),
  telefone_whatsapp       VARCHAR(20),               -- botão flutuante (só dúvidas)
  intervalo_minutos       INT NOT NULL DEFAULT 35,
  antecedencia_min_horas  INT NOT NULL DEFAULT 2,
  limite_dias_futuros     INT NOT NULL DEFAULT 120,
  barbeiro_padrao_id      INT REFERENCES usuarios(id),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ HORÁRIO DE FUNCIONAMENTO por dia da semana ============
CREATE TABLE horario_funcionamento (
  dia_semana   INT PRIMARY KEY CHECK (dia_semana BETWEEN 0 AND 6), -- 0=domingo
  aberto       BOOLEAN NOT NULL DEFAULT TRUE,
  abre         TIME NOT NULL DEFAULT '09:00',
  fecha        TIME NOT NULL DEFAULT '19:30'
);

-- ============ LIBERAÇÃO DE MESES ============
CREATE TABLE agenda_disponibilidade (
  id               INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ano              INT NOT NULL,
  mes              INT NOT NULL CHECK (mes BETWEEN 1 AND 12),
  barbeiro_id      INT REFERENCES usuarios(id),      -- NULL = vale para todos
  status           VARCHAR(10) NOT NULL DEFAULT 'fechado'
                   CHECK (status IN ('aberto','fechado')),
  limite_por_dia   INT,                              -- NULL = sem limite
  data_abertura    DATE,
  data_fechamento  DATE,
  criado_por       INT REFERENCES usuarios(id),
  UNIQUE (ano, mes, barbeiro_id)
);

-- ============ BLOQUEIOS (feriados, folgas, intervalos) ============
CREATE TABLE bloqueios_agenda (
  id           INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  barbeiro_id  INT REFERENCES usuarios(id),          -- NULL = todos
  data         DATE NOT NULL,
  hora_inicio  TIME,                                 -- NULL+NULL = dia inteiro
  hora_fim     TIME,
  motivo       VARCHAR(200),
  criado_por   INT REFERENCES usuarios(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ AGENDAMENTOS ============
CREATE TABLE agendamentos (
  id                  INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cliente_id          INT NOT NULL REFERENCES clientes(id),
  servico_id          INT NOT NULL REFERENCES servicos(id),
  barbeiro_id         INT NOT NULL REFERENCES usuarios(id),
  data_agendamento    DATE NOT NULL,
  horario_inicio      TIME NOT NULL,
  horario_fim         TIME NOT NULL,
  status              VARCHAR(12) NOT NULL DEFAULT 'pendente'
                      CHECK (status IN ('pendente','confirmado','concluido','cancelado')),
  valor_total         NUMERIC(10,2) NOT NULL,
  comissao_valor      NUMERIC(10,2) NOT NULL DEFAULT 0,
  observacoes         TEXT,
  motivo_cancelamento TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- GUARDA DE CORRIDA NO NÍVEL DO BANCO
CREATE UNIQUE INDEX uniq_slot_ativo
  ON agendamentos (barbeiro_id, data_agendamento, horario_inicio)
  WHERE status IN ('pendente','confirmado');

CREATE INDEX idx_agend_data    ON agendamentos (data_agendamento, barbeiro_id);
CREATE INDEX idx_agend_cliente ON agendamentos (cliente_id);
CREATE INDEX idx_agend_status  ON agendamentos (status);

-- ============ LOCK TEMPORÁRIO (reserva de 5 min) ============
CREATE TABLE horarios_lock (
  id           INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  barbeiro_id  INT NOT NULL REFERENCES usuarios(id),
  data         DATE NOT NULL,
  horario      TIME NOT NULL,
  session_id   VARCHAR(255) NOT NULL,
  expira_em    TIMESTAMPTZ NOT NULL,
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (barbeiro_id, data, horario)
);
CREATE INDEX idx_lock_data_horario ON horarios_lock (data, horario);
CREATE INDEX idx_lock_expira       ON horarios_lock (expira_em);

-- ============ TEMPLATES DE MENSAGEM (editáveis no admin) ============
CREATE TABLE templates_mensagem (
  id      INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chave   VARCHAR(40) NOT NULL UNIQUE,  -- 'confirmacao'|'lembrete_24h'|'pos_atendimento'
  titulo  VARCHAR(100) NOT NULL,
  corpo   TEXT NOT NULL,                -- {{nome_cliente}}, {{data}}, {{horario}}...
  ativo   BOOLEAN NOT NULL DEFAULT TRUE
);

-- ============ MENSAGENS WHATSAPP (log de envio) ============
CREATE TABLE mensagens_whatsapp (
  id               INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agendamento_id   INT REFERENCES agendamentos(id),
  template_chave   VARCHAR(40),
  telefone_destino VARCHAR(20) NOT NULL,
  mensagem_final   TEXT NOT NULL,
  status_envio     VARCHAR(12) NOT NULL DEFAULT 'pendente'
                   CHECK (status_envio IN ('pendente','enviado','entregue','falha','simulado')),
  erro             TEXT,
  enviado_em       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ OTP (verificação de celular) — tabela pronta, uso na Fase 2 ============
CREATE TABLE otp_codigos (
  id          INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  celular     VARCHAR(20) NOT NULL,
  codigo_hash VARCHAR(255) NOT NULL,
  expira_em   TIMESTAMPTZ NOT NULL,
  tentativas  INT NOT NULL DEFAULT 0,
  verificado  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ LOG DE ACESSO (auditoria / LGPD) ============
CREATE TABLE logs_acesso (
  id         INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  quem_tipo  VARCHAR(10),          -- 'usuario' | 'cliente'
  quem_id    INT,
  acao       VARCHAR(60) NOT NULL,
  ip         VARCHAR(45),
  detalhe    JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
