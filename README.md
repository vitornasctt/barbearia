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

## Fora do P1 (vem no P2)
Servidor HTTP, Express, Socket.io, rotas da API, sessões/auth, cron que chama
`limparExpirados()`, envio real de WhatsApp/SMS.
