# Sistema de Barbearia — Spec de Design (Fase 1: Núcleo)

- **Data:** 2026-09-05
- **Status:** aprovado para implementação
- **Escopo deste documento:** Fase 1 (núcleo). Fases 2–4 descritas apenas em recorte.

---

## 1. Contexto e objetivo

Sistema web full-stack para gestão de uma barbearia: site público com agendamento
online, painel administrativo, e agenda em tempo real com garantia de que dois
clientes nunca reservam o mesmo horário.

### Decisões de produto travadas no brainstorming

| Tema | Decisão |
|---|---|
| Objetivo da entrega | Sistema **pronto para deploy** (não apenas MVP local) |
| Hospedagem | **Render** como caminho documentado; **VPS** como alternativa paralela |
| Banco | **PostgreSQL** (brief estava em dialeto MySQL; portado) |
| Cache | Em memória (sem Redis no núcleo; Redis só ao escalar para múltiplas instâncias) |
| Barbeiros | Schema **multi-barbeiro**; UI da Fase 1 assume **um barbeiro padrão** |
| Entrega | **Faseada**; começa pelo núcleo; cada fase = spec + plano próprios |
| Integrações externas | **Stub com modo simulação**; ativam via `.env` sem refatorar |
| Google Maps | Cliente **tem API key** → embed do Google, com fallback OpenStreetMap |
| WhatsApp / SMS | Sem credenciais ainda → modo simulado; documentar o que é necessário |
| Stack | Express + Socket.io + EJS server-side + Alpine.js (sem build de frontend) |
| Tempo real | **Socket.io** (reconexão + fallback long-polling nativos; modelo de salas) |

### Não-objetivos da Fase 1

- Envio real de WhatsApp/SMS (Fase 2).
- Verificação de celular por OTP (Fase 2).
- Lembrete 24h e pós-atendimento automáticos (Fase 2).
- Export PDF/Excel de comissões (Fase 3).
- Escolha de profissional na UI e agenda por barbeiro (Fase 3).
- PWA, upload/otimização de imagens, push (Fase 4).

---

## 2. Arquitetura

Um único processo Node: Express + Socket.io no mesmo servidor HTTP. Sem etapa de
build no frontend. PostgreSQL é a única dependência externa obrigatória.

### 2.1 Estrutura de pastas

```
barbearia/
├── src/
│   ├── server.js                 # cria app Express + servidor HTTP + Socket.io, sobe tudo
│   ├── config.js                 # lê .env, valida, exporta config
│   ├── db/
│   │   ├── pool.js               # pool pg, helper query(), helper withTransaction()
│   │   ├── migrations/           # .sql numerados (001_init.sql, 002_...)
│   │   ├── migrate.js            # runner idempotente (tabela schema_migrations)
│   │   └── seed.js               # admin inicial, serviços exemplo, configuração, templates
│   ├── realtime/
│   │   ├── io.js                 # instância Socket.io; salas 'admin' e 'agenda:<data>'
│   │   └── events.js             # nomes de eventos centralizados (constantes)
│   ├── agenda/                   # MOTOR DE AGENDA — núcleo isolado e testável
│   │   ├── slots.js              # gera horários do dia a partir da config
│   │   ├── disponibilidade.js    # calcula horários livres
│   │   ├── locks.js              # cria/renova/libera lock temporário; limpeza
│   │   └── agendar.js            # transação de confirmação com verificação final
│   ├── services/
│   │   ├── whatsapp.js           # stub c/ modo simulação; interface p/ Meta Cloud API
│   │   ├── sms.js                # stub OTP; interface p/ Twilio/Zenvia
│   │   ├── comissao.js           # cálculo de comissão por agendamento
│   │   └── mapa.js               # embed Google Maps ou OSM conforme .env
│   ├── auth/
│   │   ├── senha.js              # bcrypt hash/verify
│   │   ├── middleware.js         # requireCliente, requireEquipe, requireAdmin
│   │   └── rateLimit.js          # limitador p/ login e envio de mensagens
│   ├── routes/
│   │   ├── publicas.js           # site do cliente (páginas + agendamento)
│   │   ├── clienteApi.js         # /api/cliente/* (área logada do cliente)
│   │   ├── adminApi.js           # /api/admin/* (painel)
│   │   └── webhooks.js           # /webhooks/whatsapp
│   ├── views/                    # EJS: layout/, cliente/, admin/
│   └── public/                   # CSS, JS de front (vanilla + Alpine via CDN), imagens
├── test/                         # node:test — foco no motor de agenda
├── docs/
│   ├── API.md
│   ├── DEPLOY.md                 # Render (principal) + alternativa VPS
│   └── WHATSAPP.md               # templates p/ Meta + configuração necessária
├── .env.example
├── package.json
└── README.md
```

### 2.2 Dependências

**Backend:** `express`, `ejs`, `pg`, `socket.io`, `bcrypt`, `express-session`,
`connect-pg-simple`, `node-cron`, `helmet`, `express-rate-limit`, `zod`, `pino`,
`pino-http`.
**Frontend:** Alpine.js e cliente Socket.io via CDN (zero build).
**Dev/teste:** `node:test` (nativo), `supertest`.

### 2.3 Princípio de isolamento

`src/agenda/` não importa Express nem Socket.io. Recebe dados, devolve dados.
O motor (parte com regras críticas de corrida) é 100% testável sem subir servidor.
As rotas orquestram: chamam o motor e, em caso de sucesso, emitem eventos de
tempo real e invalidam o cache.

---

## 3. Schema do banco (PostgreSQL)

Portabilidade: `ENUM` → `VARCHAR + CHECK`; `AUTO_INCREMENT` → `GENERATED ALWAYS AS
IDENTITY`; `DECIMAL` → `NUMERIC`; `TIMESTAMP` → `TIMESTAMPTZ`. Todas as queries da
aplicação são parametrizadas.

> Todas as tabelas abaixo são criadas na Fase 1, inclusive `otp_codigos`
> (usada só na Fase 2), para evitar migração dolorosa depois.

```sql
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

-- Sessões: tabela "session" criada automaticamente pelo connect-pg-simple.
```

### 3.1 Justificativa das adições ao brief

| Adição | Motivo |
|---|---|
| `usuarios.role` / `ativo` | Controle de acesso (admin vs barbeiro); desligar sem apagar. |
| `clientes.celular_verificado` | Suporte a OTP na Fase 2 sem migração. |
| `configuracao` + `horario_funcionamento` | Horário, endereço, GPS, telefone, intervalos são dado, não código. Linha única travada por `CHECK (id=1)`. |
| `configuracao.barbeiro_padrao_id` | UI da Fase 1 opera com um barbeiro; aqui se define qual. |
| `agenda_disponibilidade.limite_por_dia` | "Configurar limite de agendamentos por dia" do brief. |
| `bloqueios_agenda` | "Feriados e dias indisponíveis" + intervalo de almoço. |
| `uniq_slot_ativo` (índice parcial único) | Defesa final contra dois agendamentos no mesmo slot: o banco recusa o 2º INSERT. Cancelado não conta → slot volta a ficar livre sozinho. |
| `horarios_lock.expira_em` + `UNIQUE(barbeiro,data,horario)` | O `UNIQUE` torna o lock atômico; `expira_em` explícito simplifica limpeza. |
| `templates_mensagem` | Textos editáveis no painel (brief exige). |
| `mensagens_whatsapp` status `simulado` + `erro` | Modo stub grava `simulado`; driver real passa a gravar enviado/entregue/falha com diagnóstico. |
| `otp_codigos`, `logs_acesso` | OTP Fase 2 sem migração; auditoria/LGPD. |

---

## 4. Motor de agenda (`src/agenda/`)

### 4.1 `slots.js` — geração de horários do dia

`gerarSlots(config, funcionamentoDoDia, duracaoServico) -> ['09:00','09:35',...]`

- Passo = `configuracao.intervalo_minutos`. Começa em `abre`, incrementa até que
  `slot + duracaoServico > fecha` — o serviço inteiro precisa caber no expediente.
- Dia com `aberto = false` → `[]`.
- Aritmética em minutos inteiros desde meia-noite; formata `HH:MM` só na saída.
  Sem biblioteca de data.

### 4.2 `disponibilidade.js` — horários realmente livres

`horariosDisponiveis({ barbeiroId, data, servicoId, sessionId }) ->
[{ horario, disponivel, motivo? }]`

Pipeline, nesta ordem:

1. **Mês liberado?** `agenda_disponibilidade` para `(ano, mes)` do `data`, linha
   `status='aberto'` (global ou do barbeiro). Ausente → `[]` com `motivo:'mes_fechado'`.
2. **Gera todos os slots** do dia via `slots.js`.
3. **Passado / antecedência:** descarta slots antes de `agora + antecedencia_min_horas`.
4. **Agendamentos ativos:** `SELECT` do dia/barbeiro com `status IN ('pendente','confirmado')`.
   Slot bloqueado se `[slot, slot+duracao)` se sobrepõe a qualquer `[horario_inicio, horario_fim)`.
   Cobre serviço de 50 min ocupando dois passos de 35.
5. **Bloqueios:** `bloqueios_agenda` do dia (global ou do barbeiro). Sem hora = dia
   inteiro; com hora = mesma regra de sobreposição.
6. **Locks vivos de terceiros:** `horarios_lock` com `expira_em > now()` e
   `session_id <> sessionId`. O lock da própria sessão **não** é removido.
7. **Limite diário:** se `limite_por_dia` definido e a contagem de agendamentos
   ativos do dia já o atingiu → `[]` com `motivo:'limite_atingido'`.

Resultado cacheado em memória por **30 s**, chave
`disp:<barbeiroId>:<data>:<servicoId>`. **Invalidação imediata** (não espera 30 s)
sempre que um agendamento é criado/cancelado/remarcado ou um lock é criado/liberado
para aquela data.

### 4.3 `locks.js` — reserva temporária de 5 minutos

```
criarLock({ barbeiroId, data, horario, sessionId })   -> { ok } | { ok:false, erro }
renovarLock({ barbeiroId, data, horario, sessionId }) -> estende expira_em
liberarLock({ barbeiroId, data, horario, sessionId }) -> DELETE WHERE session_id = $
limparExpirados()                                      -> DELETE WHERE expira_em < now()
```

- Antes de inserir: `SELECT 1 FROM agendamentos` (índice `uniq_slot_ativo`) —
  se já é agendamento permanente, retorna `SLOT_OCUPADO` sem criar lock.
- `criarLock`:
  `INSERT ... ON CONFLICT (barbeiro_id, data, horario) DO UPDATE SET session_id=EXCLUDED.session_id, expira_em=EXCLUDED.expira_em
   WHERE horarios_lock.session_id = EXCLUDED.session_id OR horarios_lock.expira_em < now()`.
  Checa `rowCount`. Só trava quem já é dono do lock **ou** se o lock anterior
  expirou. Cliente B pedindo o slot que A segurou → `rowCount = 0` → `SLOT_TRAVADO`.
- `expira_em = now() + interval '5 minutes'`. O front chama `renovarLock` a cada
  ~2 min enquanto o formulário está aberto. Abandono → expira sozinho; `limparExpirados`
  (cron `node-cron` a cada 1 min) remove a linha.
- `liberarLock` roda ao confirmar o agendamento (o lock deu lugar ao registro real)
  ou quando o cliente clica "voltar".

### 4.4 `agendar.js` — confirmação com verificação final (transação)

```
confirmarAgendamento({ clienteId, servicoId, barbeiroId, data, horario, sessionId, observacoes })
 -> { ok:true, agendamento }
  | { ok:false, erro: 'HORARIO_INDISPONIVEL' | 'MES_FECHADO' | 'FORA_DO_EXPEDIENTE'
                     | 'LIMITE_ATINGIDO' | 'SERVICO_INVALIDO' | 'ANTECEDENCIA' }
```

Tudo em `withTransaction` (`BEGIN … COMMIT/ROLLBACK`), isolamento READ COMMITTED
(o índice único garante a exclusão, não o nível de isolamento):

1. `SELECT` do serviço `WHERE id = $ AND ativo` → `duracao_minutos`, `preco`,
   `comissao_percentual`. `horario_fim = horario + duracao`.
2. **Revalida tudo do zero** (não confia no payload do front): mês aberto, dentro
   do expediente, sem sobreposição com agendamento ativo, sem bloqueio, antecedência
   ok, limite diário ok. Mesmas regras da 4.2, agora dentro da transação.
3. `INSERT INTO agendamentos (...)`. Se `uniq_slot_ativo` disparar `unique_violation`
   (`23505`) → `ROLLBACK` e `HORARIO_INDISPONIVEL`. É o desempate final entre A e B
   quando os dois passam da verificação com milissegundos de diferença.
4. `comissao_valor = round(preco * comissao_percentual / 100, 2)` (`services/comissao.js`).
5. `DELETE FROM horarios_lock WHERE barbeiro_id=$ AND data=$ AND horario=$`.
6. `UPDATE clientes SET ultimo_agendamento = $data WHERE id = $`.
7. `INSERT INTO mensagens_whatsapp (...)` com o template `confirmacao` renderizado,
   `status='pendente'`.
8. `COMMIT`. A rota que chamou **só então** emite eventos de tempo real e invalida
   o cache; o worker de WhatsApp (stub) processa a linha `pendente` → `simulado`.

### 4.5 Cancelamento e remarcação

- `cancelarAgendamento(id, { motivo, porQuem })`: `UPDATE ... SET status='cancelado',
  motivo_cancelamento=$, updated_at=now()`. Como o índice e todas as queries de
  disponibilidade filtram `status IN ('pendente','confirmado')`, o slot reaparece
  na próxima consulta — sem job de liberação. A rota emite `agenda_atualizada`
  (sala `agenda:<data>`) + `agendamento_atualizado` com `status:'cancelado'` (sala
  `admin`) + `dashboard_tick`, e invalida o cache.
- `remarcarAgendamento(id, { novaData, novoHorario })`: uma transação que cancela o
  antigo e cria o novo (reusando a lógica de `agendar.js`); ou ambos com sucesso,
  ou `ROLLBACK`.

### 4.6 Mapa de regras obrigatórias do brief → mecanismo

| Regra | Mecanismo |
|---|---|
| Horário some na hora para os outros | `criarLock` grava lock; rota emite `horario_reservado`; passo 6 da 4.2 esconde locks de terceiros |
| Dois clientes, mesmo horário → só o 1º | `UNIQUE(barbeiro,data,horario)` no lock + `ON CONFLICT` condicional; `uniq_slot_ativo` na confirmação |
| Lock de 5 min durante preenchimento | `expira_em = now()+5min`; heartbeat `renovarLock`; cron `limparExpirados` a cada 1 min |
| Validação dupla (front + back) | Front esconde/avisa; `agendar.js` revalida tudo dentro da transação |
| Sem race condition | Transação + índice único parcial (defesa no banco) |
| Cancelado volta a ficar livre | Filtro `status IN (...)` em todo lugar |
| Intervalos de 35 min automáticos | `slots.js` a partir de `configuracao.intervalo_minutos` |
| Serviço de 50 min pula slot | Regra de sobreposição de intervalos (passo 4 da 4.2) |
| Cache para performance | Cache em memória 30 s + invalidação imediata |

---

## 5. API REST

Todo corpo de request passa por schema `zod` antes de tocar no banco (erro →
`400` com lista de campos). Queries 100% parametrizadas.

### 5.1 Rotas públicas (sem login)

| Método | Rota | Descrição |
|---|---|---|
| GET | `/` | Landing: nome, logo, endereço, mapa, horário, serviços/preços, fotos, botão flutuante WhatsApp (link `wa.me`, sem agendamento) |
| GET | `/agendar` | Página do fluxo de agendamento (5 passos) |
| GET | `/minha-conta` | Login/área do cliente |
| GET | `/privacidade` | Política de privacidade (LGPD) |
| GET | `/healthz` | Health check para o Render |
| GET | `/api/agenda/servicos` | Serviços ativos |
| GET | `/api/agenda/dias?ano=&mes=&servico_id=` | Dias com ≥1 horário livre (só meses liberados) |
| GET | `/api/agenda/horarios?data=&servico_id=` | Horários livres do dia (usa sessão anônima p/ ver o próprio lock) |
| POST | `/api/agenda/lock` | `{ data, horario, servico_id }` → lock 5 min. `200 {ok}` ou `409 SLOT_TRAVADO/SLOT_OCUPADO` |
| POST | `/api/agenda/lock/renovar` | Heartbeat |
| POST | `/api/agenda/lock/liberar` | Cliente clicou "voltar" |
| POST | `/api/agenda/cadastro` | `{ nome, celular }` ou `{ nome, celular, email, senha }` (+ consentimento LGPD). Cria/retorna cliente, abre sessão |
| POST | `/api/agenda/confirmar` | `{ servico_id, data, horario, observacoes }` + sessão cliente → `201` ou `409` com código |
| POST | `/api/auth/cliente/login` | `{ celular, senha }` |
| POST | `/webhooks/whatsapp` | Status de entrega + respostas SIM/NÃO (valida assinatura só se o segredo existir) |

Rotas de disponibilidade aceitam `barbeiro_id` opcional; omitido → `configuracao.barbeiro_padrao_id`.

### 5.2 Área do cliente (`/api/cliente/*`, sessão de cliente)

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/cliente/me` | Dados do cliente logado |
| GET | `/api/cliente/agendamentos?quando=futuros\|historico` | Lista do cliente |
| POST | `/api/cliente/agendamentos/:id/cancelar` | `{ motivo }` — só se faltam > `antecedencia_min_horas` |
| POST | `/api/cliente/agendamentos/:id/remarcar` | `{ nova_data, novo_horario }` (transação) |
| POST | `/api/auth/logout` | Encerra sessão |

### 5.3 Painel admin (`/api/admin/*`, sessão com `role in ('admin','barbeiro')`)

| Área | Método | Rota | Descrição |
|---|---|---|---|
| Auth | POST | `/api/auth/admin/login` | `{ email, senha }` — rate-limited; grava `logs_acesso` |
| Dashboard | GET | `/api/admin/dashboard` | Cortes de hoje, total do mês, faturamento do mês, comissão a receber |
| Agendamentos | GET | `/api/admin/agendamentos?data=&status=&cliente=&page=` | Lista filtrada e paginada |
| | PATCH | `/api/admin/agendamentos/:id/status` | `{ status, motivo? }` |
| | POST | `/api/admin/agendamentos` | Criação manual (mesma transação de `agendar.js`) |
| Agenda/meses | GET | `/api/admin/disponibilidade?ano=` | Calendário anual |
| | POST | `/api/admin/disponibilidade` | `{ ano, mes, status, limite_por_dia? }` |
| Bloqueios | GET/POST/DELETE | `/api/admin/bloqueios` | Feriados, folgas, intervalo |
| Serviços | GET/POST/PATCH/DELETE | `/api/admin/servicos` | CRUD; DELETE soft (`ativo=false`) se houver histórico |
| Clientes | GET | `/api/admin/clientes?busca=` | Busca por nome/celular |
| | GET | `/api/admin/clientes/:id` | Ficha + histórico |
| | POST | `/api/admin/clientes/:id/anonimizar` | LGPD |
| Comissão | GET | `/api/admin/comissoes?mes=&ano=&barbeiro_id=` | Relatório calculado (JSON; PDF/Excel na Fase 3) |
| Config | GET/PUT | `/api/admin/configuracao` | Nome, endereço, GPS, telefone, intervalos, expediente por dia |
| Templates | GET/PUT | `/api/admin/templates` | Editar os 3 textos |
| Mensagens | GET | `/api/admin/mensagens?agendamento_id=` | Log de envios |
| | POST | `/api/admin/mensagens/enviar` | `{ agendamento_id, template_chave }` → enfileira (stub: `simulado`) |

---

## 6. Tempo real (Socket.io)

**Salas:**
- Cliente no site → sala `agenda:<data>` da data visível (troca ao mudar de dia).
- Painel admin autenticado → sala `admin`.
- O handshake do Socket.io compartilha o cookie de sessão do Express (mesmo
  servidor), então o servidor sabe se é admin ou visitante.

**Eventos emitidos pelo servidor:**

| Evento | Destino | Quando | Payload |
|---|---|---|---|
| `horario_reservado` | `agenda:<data>` | lock criado | `{ data, horario }` |
| `horario_liberado` | `agenda:<data>` | lock liberado/expirado | `{ data, horario }` |
| `agenda_atualizada` | `agenda:<data>` | agendamento criado/cancelado/remarcado | `{ data }` |
| `novo_agendamento` | `admin` | agendamento criado (qualquer origem) | `{ id, cliente, servico, data, horario, status }` |
| `agendamento_atualizado` | `admin` | mudança de status | `{ id, status }` |
| `dashboard_tick` | `admin` | qualquer um dos acima | contadores atualizados |

**Front — cliente:** ao receber `horario_reservado`/`agenda_atualizada`, remove/
reconsulta os horários e mostra *"Este horário acabou de ser reservado!"* se era o
que o cliente ia escolher.
**Front — admin:** `novo_agendamento` → nova linha + toast + som + contadores;
`agendamento_atualizado` → muda cor/estado da linha. Sem refresh.
**Fallback:** Socket.io cai sozinho para long-polling; se nem isso, o front tem
`setInterval` de 30 s re-consultando `GET /api/agenda/horarios`.

### 6.1 Ordem canônica de um agendamento

```
Cliente escolhe serviço + dia + horário
  → POST /api/agenda/lock ──(ok)──► emite horario_reservado p/ agenda:<data>; invalida cache
  → tela de dados (heartbeat POST /lock/renovar a cada 2 min)
  → POST /api/agenda/cadastro  (cria cliente + sessão)
  → POST /api/agenda/confirmar
        └─ agendar.confirmarAgendamento (transação: revalida, INSERT, apaga lock, msg)
             ├─ sucesso → 201; emite agenda_atualizada + novo_agendamento + dashboard_tick;
             │            invalida cache; worker WhatsApp (stub) processa 'pendente' → 'simulado'
             └─ 409 HORARIO_INDISPONIVEL → front volta ao passo do horário e recarrega a grade
```

---

## 7. Frontend

Renderização server-side (EJS) + Alpine.js + cliente Socket.io. CSS próprio,
mobile-first, tema dark com tom de destaque, tipografia grande, alto contraste.
Acessibilidade: navegação por teclado, `label` em todo campo, contraste AA.

### 7.1 Site do cliente

| Página | Conteúdo |
|---|---|
| **Início** (`/`) | Header logo + nome. Seções: sobre, serviços com preço, galeria, horário de funcionamento (da `configuracao`), endereço com mapa embed + botão "Como chegar" (link `google.com/maps/dir`). Botão flutuante WhatsApp fixo → `wa.me/<telefone>` com texto de dúvida (nunca leva ao agendamento). |
| **Agendar** (`/agendar`) | Uma página, 5 passos com Alpine: (1) cartões de serviço → (2) calendário do mês (só meses liberados; dias sem vaga em cinza) → (3) grade de horários (atualiza via Socket.io; ao clicar, `POST /lock` + cronômetro *"reservado por 04:59"*) → (4) formulário (nome + celular; link "quero criar senha" revela email+senha; checkbox LGPD) → (5) revisão e confirmar. Tela de sucesso com resumo + aviso de confirmação no WhatsApp. |
| **Área do cliente** (`/minha-conta`) | Login por celular+senha (ou "entrar sem senha" reusando cadastro simples). Abas: Próximos (cancelar/remarcar respeitando antecedência) e Histórico. |

### 7.2 Painel admin (`/admin`)

Layout com barra lateral. Todas as telas recebem atualizações via sala `admin`.

| Tela | Conteúdo |
|---|---|
| **Login** | email + senha, rate-limited |
| **Dashboard** | 4 cards (cortes hoje / agendamentos no mês / faturamento no mês / comissão a receber) atualizados por `dashboard_tick`; lista "Próximos de hoje"; toast + som em `novo_agendamento` |
| **Agendamentos** | Tabela com filtros (data, status, cliente) e paginação; ações: confirmar, concluir, cancelar (modal pede motivo); "Novo agendamento"; "Enviar confirmação WhatsApp"; cores por status |
| **Agenda / Meses** | Grade anual (12 meses); por mês: badge aberto/fechado, botão abrir/fechar, campo "limite por dia" |
| **Bloqueios** | Lista + form: data, dia inteiro ou faixa, motivo |
| **Serviços** | Tabela editável: nome, duração, preço, % comissão, ativo |
| **Clientes** | Busca por nome/celular; ficha com histórico; botão anonimizar (LGPD) |
| **Comissões** | Filtro mês/ano; tabela serviço / qtde / faturamento / % / comissão; total no rodapé; botões PDF/Excel desabilitados ("em breve" — Fase 3) |
| **Configuração** | Form: nome, endereço, lat/long, telefone WhatsApp, intervalo, antecedência, expediente por dia da semana |
| **Templates** | 3 editores de texto com lista de variáveis e preview |
| **Mensagens** | Log de `mensagens_whatsapp` com status e erro |

---

## 8. Autenticação e segurança

- **Sessões** via `express-session` + `connect-pg-simple` (tabela `session`).
  Cookie `httpOnly`, `secure` em produção, `sameSite=lax`. Duas faces:
  `req.session.clienteId` e `req.session.usuarioId` + `role`. Middlewares:
  `requireCliente`, `requireEquipe`, `requireAdmin`.
- **Senhas** com `bcrypt` (cost 12). Nunca logadas nem retornadas.
- **Expiração por inatividade:** `rolling: true`; `maxAge` 30 dias (cliente),
  12 h (equipe).
- **Brute force:** `express-rate-limit` no login (5 tentativas / 15 min por
  IP+email) e no envio de mensagens. Tentativas em `logs_acesso`.
- **Headers:** `helmet` com CSP liberando só os CDNs do Alpine/Socket.io e o
  `frame-src` do provedor de mapa.
- **Input:** `zod` em todo corpo; celular normalizado para dígitos; EJS escapa por
  padrão.
- **SQL:** exclusivamente parametrizado (`pg` com `$1,$2`).
- **HTTPS:** terminado pelo Render; no VPS via nginx + Certbot. `app.set('trust proxy', 1)`.
- **LGPD:** página `/privacidade`; export e anonimização de cliente no admin
  (`nome='removido'`, celular embaralhado, mantém agendamentos para histórico
  financeiro); consentimento no cadastro (checkbox + texto).
- **Backup:** Render faz backup diário do Postgres gerenciado; `DEPLOY.md` inclui
  `pg_dump` agendável para cópia externa.

---

## 9. Integrações stub

Cada serviço: uma função de interface + um "driver". Sem credencial no `.env`,
usa o driver `simulado` (grava no banco, loga, não envia). Com credencial, troca
para o driver real sem mexer no resto do código.

### 9.1 WhatsApp — `services/whatsapp.js`

- **Fase 1 (stub):** `enviarMensagem(agendamentoId, templateChave)` renderiza o
  template, grava em `mensagens_whatsapp` com `status='simulado'`, emite evento
  pro admin. `/webhooks/whatsapp` aceita chamadas; valida assinatura só se o
  segredo existir.
- **Driver real (Fase 2):** Meta **WhatsApp Cloud API**
  (`POST https://graph.facebook.com/v20.0/<phone_number_id>/messages`).
- **Necessário do cliente:** conta **Meta Business** verificada; **número**
  dedicado registrado na Cloud API; `WHATSAPP_PHONE_NUMBER_ID`; `WHATSAPP_TOKEN`
  (token permanente de sistema); `WHATSAPP_VERIFY_TOKEN` (inventado, usado no
  handshake do webhook); os **3 templates aprovados** no Gerenciador do WhatsApp
  (categoria "Utility"); URL do webhook `https://<APP_URL>/webhooks/whatsapp`
  cadastrada no painel da Meta.

### 9.2 SMS / OTP — `services/sms.js`

- **Fase 1:** OTP **não entra**. Cadastro é celular+nome direto. Tabela
  `otp_codigos` e funções `enviarOtp`/`verificarOtp` prontas em modo simulado
  (código fixo `000000` em dev).
- **Driver real (Fase 2):** Twilio (`Verify` API) ou Zenvia (BR).
- **Necessário do cliente:** Twilio → `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
  `TWILIO_VERIFY_SERVICE_SID`. Ou Zenvia → `ZENVIA_TOKEN` + remetente aprovado.
  Alternativa sem custo de SMS: enviar OTP pelo próprio WhatsApp após a Cloud API
  estar ativa.

### 9.3 Mapa — `services/mapa.js`

- **Fase 1:** cliente tem `GOOGLE_MAPS_API_KEY` (billing ativo; APIs *Maps Embed*
  e *Maps JavaScript* habilitadas; restrição por HTTP referrer). Usa embed do
  Google.
- **Fallback:** sem a chave, `<iframe>` do **OpenStreetMap** centrado em
  `latitude/longitude` da `configuracao`. Botão "Como chegar" funciona nos dois
  casos.

### 9.4 `.env.example`

```
NODE_ENV=production
PORT=3000
DATABASE_URL=postgres://...
SESSION_SECRET=<64 hex aleatórios>
APP_URL=https://seu-dominio
ADMIN_EMAIL=dono@barbearia.com
ADMIN_SENHA=<trocar no primeiro login>
# Mapa (cliente já tem)
GOOGLE_MAPS_API_KEY=
# WhatsApp (Fase 2 → ativa envio real)
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_TOKEN=
WHATSAPP_VERIFY_TOKEN=
# SMS/OTP (Fase 2, opcional)
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_VERIFY_SERVICE_SID=
```

Bloco vazio ⇒ aquele serviço roda em modo simulado; o sistema sobe normalmente.

---

## 10. Deploy

### 10.1 Render (caminho principal — `docs/DEPLOY.md`)

1. **Banco:** criar PostgreSQL no Render → copiar *Internal Database URL*.
2. **Serviço web:** *New → Web Service*, conectar o repositório. Build: `npm ci`.
   Start: `npm start` (roda migrations pendentes + sobe o servidor). Health check:
   `GET /healthz`.
3. **Variáveis:** colar o bloco do `.env.example`. `DATABASE_URL` = URL interna.
   `SESSION_SECRET` = `node -e "console.log(crypto.randomBytes(32).toString('hex'))"`.
4. **Migrations + seed:** automáticos no start (idempotente via `schema_migrations`).
   Seed cria o admin a partir de `ADMIN_EMAIL`/`ADMIN_SENHA`.
5. **Cron:** `node-cron` interno cuida da limpeza de locks — não precisa do Cron
   Job pago. Cron Job opcional para `pg_dump` externo diário.
6. **Domínio:** domínio custom no Render (HTTPS automático). Atualizar `APP_URL`.
7. **WhatsApp (Fase 2):** cadastrar `https://<APP_URL>/webhooks/whatsapp` na Meta
   com o `WHATSAPP_VERIFY_TOKEN`.

**Custo aproximado:** Web Service Starter (US$ 7) + Postgres Basic (US$ 7) ≈
**US$ 14/mês**. Free tier serve para validar (dorme após inatividade).

### 10.2 Alternativa VPS (seção paralela no mesmo `DEPLOY.md`)

Ubuntu 22.04+: Node 20 LTS + PostgreSQL; criar banco/usuário; clonar; `npm ci`;
`.env` com `DATABASE_URL` local; `npm start` sob **PM2**
(`pm2 start src/server.js --name barbearia && pm2 save && pm2 startup`);
**nginx** reverse proxy para :3000 com headers `Upgrade`/`Connection` (WebSocket);
**Certbot** para SSL; `ufw` liberando 22/80/443; cron do sistema com `pg_dump`
diário. Custo ~€4–5/mês; manutenção por conta do cliente.

---

## 11. Estratégia de testes

Runner nativo `node:test`. Prioridade no que tem risco real.

- **Motor de agenda (`src/agenda/*`) — cobertura alta:**
  - `slots.js`: expediente 09:00–19:30 passo 35 → sequência correta; serviço de
    50 min corta o último slot; dia fechado → `[]`.
  - `disponibilidade.js`: remove agendamento ativo; **não** remove cancelado;
    serviço de 50 min bloqueia 2 passos; respeita bloqueio de dia inteiro e de
    faixa; respeita antecedência; mês fechado → `[]`; limite diário.
  - `locks.js`: 2ª sessão no mesmo slot → `SLOT_TRAVADO`; lock expirado é
    sobrescrito; `liberarLock` só apaga o da própria sessão; `limparExpirados`
    remove o vencido.
  - `agendar.js` (**concorrência**): N confirmações em paralelo (`Promise.all`)
    para o mesmo slot contra Postgres de teste → exatamente **1** sucesso, resto
    `HORARIO_INDISPONIVEL`. Revalidação recusa mês fechado / fora do expediente
    mesmo com payload adulterado.
  - `comissao.js`: arredondamento a 2 casas.
- **Rotas (integração, `supertest` + Postgres de teste):** cadastro simples e com
  senha; fluxo lock→confirmar→409 no segundo; middlewares barram acesso sem
  sessão / sem role; `zod` rejeita corpo inválido.
- **Fumaça de tempo real:** cliente Socket.io de teste na sala `agenda:<data>`
  recebe `agenda_atualizada` após um `POST /confirmar`.
- **CI:** GitHub Actions sobe `postgres:16`, roda migrations e `npm test` em cada
  push.
- **Banco de teste:** `DATABASE_URL_TEST` separado; cada teste em transação com
  `ROLLBACK`, ou `TRUNCATE ... RESTART IDENTITY CASCADE` no `beforeEach`.

---

## 12. Recorte das fases

### Fase 1 — Núcleo (este documento)

Banco completo (todas as tabelas, inclusive as de fases futuras) · migrations +
seed · auth de equipe e de cliente · **motor de agenda inteiro** (locks,
transação, tempo real) · site do cliente (início + agendar + área do cliente) ·
painel admin (dashboard, agendamentos, meses, bloqueios, serviços, clientes,
configuração, templates, log de mensagens) · relatório de comissão **em tela**
(JSON/HTML) · WhatsApp/SMS/mapa em **modo simulado** (mapa real se a key vier) ·
deploy no Render funcionando · testes do núcleo · `docs/` (API, DEPLOY, WHATSAPP).

### Fase 2 — WhatsApp real + OTP

Driver Meta Cloud API · parser de status de entrega · webhook processando
SIM/NÃO · verificação de celular por OTP · job de lembrete 24h antes (cron) ·
job de pós-atendimento ao concluir.

### Fase 3 — Comissões e relatórios

Export PDF (`pdfkit`) e Excel (`exceljs`) · histórico de comissões por período ·
dashboard financeiro completo · múltiplos barbeiros na **UI** (escolha de
profissional, agenda por barbeiro, comissão por barbeiro).

### Fase 4 — Extras

PWA (manifest + service worker) · otimização de imagens (upload com resize) ·
página de relatórios exportáveis · notificações push.

---

## 13. Templates de mensagem iniciais (seed)

**`confirmacao`:**
```
Olá, {{nome_cliente}}!
Seu agendamento para {{nome_servico}} está confirmado!
📅 Data: {{data}}
⏰ Horário: {{horario}}
📍 Local: {{endereco_barbearia}}
Para confirmar, responda SIM. Para cancelar ou remarcar, responda NÃO.
```

**`lembrete_24h`:**
```
Olá, {{nome_cliente}}!
Lembrete: seu corte está agendado para amanhã às {{horario}}.
Estamos aguardando você! 💈
```

**`pos_atendimento`:**
```
Olá, {{nome_cliente}}!
Obrigado por visitar nossa barbearia!
Esperamos vê-lo em breve. 💈
Indique para os amigos e ganhe desconto!
```

Variáveis disponíveis: `{{nome_cliente}}`, `{{nome_servico}}`, `{{data}}`,
`{{horario}}`, `{{endereco_barbearia}}`, `{{nome_barbearia}}`.
