# Barbearia — Backend (P1: Fundação + Motor de Agenda)

## Pré-requisitos
- Node 20 ou superior
- Um projeto **Supabase** (PostgreSQL). Não usa Docker nem Postgres local.

## Setup
```bash
cp .env.example .env          # preencha DATABASE_URL (Session Pooler do Supabase) e SESSION_SECRET
cp .env.test.example .env.test
npm install
npm run db:reset              # cria schema public + tabelas + seed (desenvolvimento)
```

`DATABASE_URL` usa o **Session Pooler** do Supabase (porta 5432). Se a senha do
banco tiver caractere especial (`& + $ ? ...`), ela precisa estar
**percent-encoded** dentro da URL.

## Isolamento dev × teste
Mesmo banco, schemas diferentes: desenvolvimento no schema `public`, testes no
schema `test` (`TEST_SCHEMA`). `npm test` roda com `NODE_ENV=test` e nunca toca
os dados de `public`.

## Comandos
| Comando | O quê |
|---|---|
| `npm test` | Suíte completa (`node:test`), no schema `test` |
| `npm run db:migrate` | Aplica migrations pendentes (schema `public`) |
| `npm run db:seed` | Aplica o seed idempotente (schema `public`) |
| `npm run db:reset` | Migra + trunca + semeia (schema `public`) |

## O que existe no P1
- Camada de banco (`src/db/`): pool, migrations idempotentes, seed.
- Motor de agenda (`src/agenda/`): `slots`, `disponibilidade` (+ `verificarSlot`),
  `locks`, `agendar` (`confirmarAgendamento`, `cancelarAgendamento`,
  `remarcarAgendamento`), `cache`.
- Utilidades (`src/lib/`): `tempo`, `template`. Serviço `comissao`.

## P2 — servidor HTTP + tempo real

```bash
npm start            # sobe Express + Socket.io + cron na porta de PORT (.env)
npm run dev          # idem com --watch
```

### Rotas (resumo)
- **Pública** `/api/agenda/*`: `servicos`, `dias`, `horarios`, `lock`/`renovar`/`liberar`,
  `cadastro`, `confirmar`. `/api/auth/*`: `admin/login`, `cliente/login`, `logout`.
  `/healthz`. `/webhooks/whatsapp`.
- **Cliente** `/api/cliente/*` (sessão de cliente): `me`, `agendamentos`, `:id/cancelar`, `:id/remarcar`.
- **Admin** `/api/admin/*` (sessão de equipe; algumas exigem `role=admin`):
  `dashboard`, `agendamentos` (listar / `:id/status` / criar), `disponibilidade`,
  `bloqueios`, `servicos`, `clientes` (+ `:id/anonimizar`), `comissoes`,
  `configuracao`, `templates`, `mensagens` (+ `/enviar`).

### Tempo real (Socket.io, mesmo servidor)
Salas `agenda:<YYYY-MM-DD>` (cliente emite `entrar_agenda`/`sair_agenda`) e `admin`
(automático para sessão de equipe). Eventos: `horario_reservado`,
`horario_liberado`, `agenda_atualizada`, `novo_agendamento`,
`agendamento_atualizado`, `dashboard_tick`.

### Sessão e segurança
Sessão em Postgres (`connect-pg-simple`, schema-aware). Cookie `httpOnly` +
`sameSite=lax` + `secure` em produção. `exigirOrigemConfiavel` em toda rota
mutadora. Rate limit no login (5/15min) e no envio de mensagens (30/5min).
`logs_acesso` em toda tentativa de login.

### Integrações (stub no P2)
- **WhatsApp:** sem `WHATSAPP_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID` → driver `simulado`
  (grava `status_envio='simulado'`). Com ambos → driver `meta` (Cloud API).
  Webhook: `GET /webhooks/whatsapp` faz o handshake se `WHATSAPP_VERIFY_TOKEN`
  estiver setado; `POST` valida `X-Hub-Signature-256` se `WHATSAPP_APP_SECRET`.
- **SMS/OTP:** `src/services/sms.js` pronto em modo simulado (código `000000`);
  não há rota de OTP no P2.
- **Mapa:** `src/services/mapa.js` — Google Embed com `GOOGLE_MAPS_API_KEY`,
  senão OpenStreetMap.

### Novas variáveis (.env)
`ORIGENS_PERMITIDAS` (CSV), `COOKIE_SECURE` (`1` força secure), `WHATSAPP_APP_SECRET`,
`LOG_LEVEL`. `SESSION_SECRET` deve ter ≥32 chars em produção.

## Fora do P2 (P3/P4)
Frontend (EJS/CSS/Alpine), páginas `/`, `/agendar`, `/minha-conta`, `/privacidade`;
`DEPLOY.md` + Render + CI; CSRF por token; export PDF/Excel; OTP no cadastro;
driver real da WhatsApp Cloud API exercitado com credencial.
