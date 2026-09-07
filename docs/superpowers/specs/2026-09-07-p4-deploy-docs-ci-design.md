# Sistema de Barbearia — Spec de Design (P4: Deploy + Docs + CI)

- **Data:** 2026-09-07
- **Status:** aprovado para implementação
- **Depende de:** P1 + P2 + P3 (todos mergeados em `main`)
- **Documento-pai:** `docs/superpowers/specs/2026-09-05-barbearia-nucleo-design.md` (§9 integrações, §10 deploy, §12 fases, §13 templates)

---

## 1. Escopo

P4 fecha o núcleo deixando o sistema **pronto para deploy**: inicialização
que aplica migrações e seed sozinha, documentação de deploy (Render + VPS),
CI no GitHub Actions com Postgres isolado, referência de API, os 3 templates
de WhatsApp no formato de submissão da Meta, e o último buraco funcional do
painel (criar agendamento manual). Mais dois endurecimentos pequenos de banco
e boot herdados como follow-ups do P2/P3.

### Entra no P4

1. **Boot com migração + seed automáticos** — `npm start` aplica migrações
   pendentes e o seed idempotente antes de aceitar requisições.
2. **Migração `004`** — `UNIQUE NULLS NOT DISTINCT` em
   `disponibilidade_meses(ano, mes, barbeiro_id)` (o `UNIQUE` atual não cobre
   `barbeiro_id NULL` — follow-up parkeado do P2).
3. **Tela "Novo agendamento" no admin** — formulário em
   `admin/agendamentos.ejs` consumindo o `POST /api/admin/agendamentos` que já
   existe (follow-up P3.1).
4. **`.env.example` + `.env.test.example` finais** — agrupados, comentados,
   todas as chaves conferidas contra `src/config.js`.
5. **`docs/DEPLOY.md`** — Render (caminho principal) + VPS (seção paralela),
   com tabela de custo e o passo do webhook da Meta.
6. **`docs/API.md`** — referência de todas as rotas `/api/*`, `/webhooks/*` e
   páginas, com contrato de erro.
7. **`docs/whatsapp-templates.md`** — os 3 templates no formato do Gerenciador
   de Modelos da Meta (categoria, corpo com `{{1}}…{{n}}`, mapa de variáveis).
8. **`.github/workflows/ci.yml`** — em push/PR: Node 24, `npm ci`, container
   de serviço `postgres:17`, `npm test` contra esse banco efêmero (resolve a
   fragilidade do schema `test` remoto compartilhado — só no CI).
9. **README reescrito** — cobre P1–P4, setup, deploy, arquitetura, índice de
   specs/planos.
10. **Verificação de endurecimento de produção** — cookie `secure`,
    `trust proxy`, `ORIGENS_PERMITIDAS`, HSTS, shutdown gracioso: confirmar que
    o código já faz (a maioria faz) e documentar o que o operador precisa setar.

### Não entra no P4 (follow-ups / fases seguintes)

- **Wiring ao vivo de WhatsApp Cloud API ou Twilio.** O cliente ainda não tem
  conta Meta Business nem número registrado nem Twilio. O driver real do
  WhatsApp já está escrito (`src/services/whatsapp.js`) e ativa sozinho quando
  as env vars aparecem; P4 só documenta o que é necessário. SMS/OTP continua
  no driver `simulado`.
- **Feature de OTP** (rota + tela + verificação por SMS). O cadastro segue
  celular+nome direto, como o P2 decidiu.
- **Automação de lembrete 24h e pós-atendimento.** Hoje nada enfileira esses
  dois templates; só `confirmacao` é disparado (na confirmação/conclusão).
  Um cron que varre agendamentos do dia seguinte é feature de P5.
- **Escolha de profissional na UI, agenda por barbeiro, PDF/Excel de
  comissões, PWA, upload de imagens** — pós-núcleo.
- **Dockerfile / docker-compose.** Render roda direto do repo (`npm ci` +
  `npm start`); o VPS usa PM2. Sem container próprio no núcleo.
- **Provisionar o repositório remoto no GitHub e ligar o CI.** O `ci.yml` é
  entregue pronto mas fica dormente até o cliente dar `git push` para um
  remote — não há remote configurado hoje.

---

## 2. Arquivos

**Criados:**

| Path | Responsabilidade |
|---|---|
| `src/db/migrations/004_meses_nulls_not_distinct.sql` | troca o `UNIQUE (ano,mes,barbeiro_id)` por versão `NULLS NOT DISTINCT` |
| `src/bootstrap.js` | `export async function inicializar({ semear: boolean })` — roda `migrar()` e opcionalmente `semear()`; usado pelo entrypoint |
| `src/public/js/admin/novo-agendamento.js` | (ou expande `admin/agendamentos.js`) componente do formulário de criação manual |
| `.github/workflows/ci.yml` | pipeline de CI |
| `docs/DEPLOY.md` | guia de deploy Render + VPS |
| `docs/API.md` | referência de rotas |
| `docs/whatsapp-templates.md` | os 3 modelos no formato Meta |
| `test/db/migrate-004.test.js` | a constraint nova existe e rejeita duplicata com `barbeiro_id NULL` |
| `test/boot/bootstrap.test.js` | `inicializar()` aplica migrações e (quando pedido) seed, idempotente |
| `test/http/admin-novo-agendamento.test.js` | `POST /api/admin/agendamentos` pela tela: cliente novo e cliente existente; 409 em horário ocupado |
| `test/config/env-example.test.js` | toda chave de `.env.example` / `.env.test.example` é aceita por `carregarConfig` e cobre o schema |
| `test/services/templates-meta.test.js` | os 3 templates semeados só usam as 6 variáveis conhecidas e renderizam sem `{{…}}` sobrando |

**Modificados:**

| Path | Mudança |
|---|---|
| `src/server.js` | entrypoint (`if (ehEntrypoint)`) chama `await inicializar({ semear: true })` antes de `server.listen`; `criarServidor()` em si não muda |
| `package.json` | `start` continua `node --env-file=.env src/server.js` (o boot agora migra/semeia); adiciona `"db:setup"` opcional; `engines.node` → `>=20` mantido, alinhar com `.nvmrc` (24) num comentário do DEPLOY |
| `src/views/admin/agendamentos.ejs` | + bloco "Novo agendamento" (form/modal Alpine) |
| `src/public/js/admin/agendamentos.js` | + estado e métodos do formulário de criação (busca de cliente, dias, horários, submit) |
| `.env.example`, `.env.test.example` | agrupamento + comentários; nada removido |
| `README.md` | reescrito para o sistema completo |

Sem mudança em `src/app.js`, no motor de agenda, nas rotas `/api` (o
`POST /agendamentos` já existe), nem em `src/services/*` (drivers já prontos).

---

## 3. Boot com migração + seed (Tarefa 1)

`src/bootstrap.js`:

```js
import { migrar } from './db/migrate.js';
import { semear } from './db/seed.js';

export async function inicializar({ semear: comSeed = false } = {}) {
  await migrar({ silent: false });
  if (comSeed) await semear();
}
```

`src/server.js`, no bloco `if (ehEntrypoint)`, antes do `listen`:

```js
const { inicializar } = await import('./bootstrap.js');
await inicializar({ semear: true });
```

- `semear()` é idempotente (`ON CONFLICT DO NOTHING` em tudo; o admin usa
  `ON CONFLICT (email) DO UPDATE SET nome = usuarios.nome`, ou seja não
  sobrescreve senha). Seguro rodar todo start.
- `criarServidor()` **não** chama `inicializar()` — assim `test/realtime/fluxo.test.js`
  (que usa `criarServidor`) não paga migração/seed a cada run.
- Falha de migração aborta o start com exit ≠ 0 (Render marca o deploy como
  falho e mantém a versão anterior).
- `NODE_ENV=production` + `SESSION_SECRET` curto já aborta em `carregarConfig`.

## 4. Migração 004 (Tarefa 2)

`disponibilidade_meses` hoje tem `UNIQUE (ano, mes, barbeiro_id)`. Em Postgres,
`NULL` distinto de `NULL` num índice único ⇒ dois registros "mês global"
(`barbeiro_id IS NULL`) para o mesmo ano/mês podem coexistir. O repo
`disponibilidadeMeses.definir` já contorna com upsert CTE `IS NOT DISTINCT FROM`,
mas a corrida continua possível.

```sql
-- 004_meses_nulls_not_distinct.sql
ALTER TABLE disponibilidade_meses
  DROP CONSTRAINT IF EXISTS disponibilidade_meses_ano_mes_barbeiro_id_key;
ALTER TABLE disponibilidade_meses
  ADD CONSTRAINT disponibilidade_meses_ano_mes_barbeiro_uk
  UNIQUE NULLS NOT DISTINCT (ano, mes, barbeiro_id);
```

- Requer PostgreSQL ≥ 15 (Supabase 17, Render Postgres ≥ 15, VPS deve usar
  ≥ 15 — anota no DEPLOY). O `DROP CONSTRAINT IF EXISTS` usa o nome
  auto-gerado; confirmar o nome real com `\d disponibilidade_meses` /
  `information_schema` na hora de escrever.
- Teste: insere `(2030, 6, NULL, 'aberto')` duas vezes → a segunda viola a
  constraint. E o teste do repo `meses` do P3 continua passando.
- O repo `definir` pode então simplificar para `ON CONFLICT (ano, mes, barbeiro_id)`
  — **opcional**, fora do escopo desta tarefa; deixar o CTE como está evita
  regressão.

## 5. Tela "Novo agendamento" (Tarefa 3)

Endpoint (já existe, `src/routes/adminApi.js`): `POST /api/admin/agendamentos`
- corpo: `{ servico_id, data, horario, observacoes?, barbeiro_id? }` +
  **ou** `cliente_id` **ou** `cliente: { nome, celular }`.
- `201 { agendamento }` ou `409 { erro }` (mesmos códigos do fluxo público).

UI: um `<details>`/modal "Novo agendamento" no topo de `admin/agendamentos.ejs`,
componente Alpine (pode ser um segundo `x-data` ou estado dentro de
`painelAgendamentos`):
- Cliente: campo de busca → `GET /api/admin/clientes?busca=` mostra resultados;
  clicar seleciona `cliente_id`. Link "cadastrar novo" revela nome + celular
  (manda `cliente: {nome, celular}`).
- Serviço: `<select>` de `GET /api/admin/servicos`.
- Data: `GET /api/agenda/dias?ano=&mes=&servico_id=` (reusa a lógica do P3).
- Horário: `GET /api/agenda/horarios?data=&servico_id=`.
- Observações: textarea.
- Enviar → `POST`. `201` → toast + fecha + `buscar()` recarrega a lista (e o
  socket `novo_agendamento` já chega). `409` → toast com a mensagem do código.

Segue Ruling P1 do P3 (rodapé de registro guardado por `typeof window`).

## 6. `.env.example` / `.env.test.example` (Tarefa 4)

Reagrupar com comentários, sem remover chave. Blocos:

```
# --- Obrigatório ---
NODE_ENV, PORT, TZ, DATABASE_URL, SESSION_SECRET, APP_URL, ADMIN_EMAIL, ADMIN_SENHA
# --- Produção (atrás de proxy TLS) ---
COOKIE_SECURE=1          # cookie de sessão só por HTTPS
ORIGENS_PERMITIDAS=https://seu-dominio   # csv; vazio em dev libera localhost
# --- Mapa (cliente já tem a chave) ---
GOOGLE_MAPS_API_KEY=
# --- WhatsApp Cloud API (Fase pós-núcleo; vazio = modo simulado) ---
WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_TOKEN, WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET
# --- SMS/OTP Twilio (opcional; vazio = modo simulado) ---
TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_SID
# --- Observabilidade ---
LOG_LEVEL=info
TEST_SCHEMA=test         # só usado por npm test
```

Teste (`test/config/env-example.test.js`): parseia os dois arquivos, monta um
objeto (chave=valor, ignora comentários/vazios; para chaves de exemplo com
placeholder usa um valor plausível), roda `carregarConfig(objeto)` e afirma que
não lança; e afirma que todo campo do `schema` de `config.js` aparece em pelo
menos um dos dois arquivos (nada esquecido na doc).

## 7. `docs/DEPLOY.md` (Tarefa 5)

Estrutura (prosa, sem teste automatizado — revisão de conteúdo):

### 7.1 Render (principal)
1. **Banco:** Render PostgreSQL (≥ 15) → copiar *Internal Database URL*. Ou
   manter o Supabase existente (Session Pooler, porta 5432, senha
   percent-encoded).
2. **Web Service:** conectar o repo. Build `npm ci`. Start `npm start` (aplica
   migrações + seed e sobe). Health check `GET /healthz`.
3. **Env:** colar o bloco do `.env.example`. `DATABASE_URL` = interna.
   `SESSION_SECRET` = `node -e "console.log(crypto.randomBytes(32).toString('hex'))"`.
   `NODE_ENV=production`, `APP_URL=https://<dominio>`, `COOKIE_SECURE=1`,
   `ORIGENS_PERMITIDAS=https://<dominio>`.
4. **Node:** `.nvmrc` fixa 24; `engines` pede ≥ 20. Render respeita o `.nvmrc`.
5. **Cron:** `node-cron` interno cuida de locks + fila de mensagens — não
   precisa do Cron Job pago. Opcional: Cron Job diário de `pg_dump` externo.
6. **Domínio:** custom domain no Render (HTTPS automático). Atualizar `APP_URL`
   e `ORIGENS_PERMITIDAS`.
7. **WhatsApp (quando ativar):** cadastrar `https://<APP_URL>/webhooks/whatsapp`
   no painel da Meta com o `WHATSAPP_VERIFY_TOKEN`; o `GET` do webhook já
   responde o `hub.challenge`.

**Custo:** Web Service Starter US$7 + Postgres Basic US$7 ≈ **US$14/mês**.
Free tier valida (dorme após inatividade — o WebSocket cai junto).

### 7.2 VPS (alternativa, seção paralela)
Ubuntu 22.04+: Node 20 LTS (via nvm/nodesource) + PostgreSQL ≥ 15; criar
banco/usuário; clonar; `npm ci`; `.env` com `DATABASE_URL` local +
`NODE_ENV=production` + `COOKIE_SECURE=1`; `npm start` sob **PM2**
(`pm2 start "npm run start" --name barbearia && pm2 save && pm2 startup`);
**nginx** reverse proxy para `:3000` com `proxy_set_header Upgrade`/`Connection`
(WebSocket) e `X-Forwarded-Proto`; **Certbot** para TLS; `ufw` 22/80/443;
cron do sistema com `pg_dump` diário. Custo ~€4–5/mês; manutenção do cliente.

### 7.3 Backup e rollback
`pg_dump` agendável (Render Cron Job ou cron do VPS). Rollback: Render mantém a
versão anterior se o start falhar; migrações são forward-only e transacionais
(uma por vez) — reverter é restaurar dump.

## 8. `docs/API.md` (Tarefa 6)

Tabela por área, gerada a partir das rotas reais (`src/routes/*.js`):
- **Páginas:** `GET /`, `/agendar`, `/minha-conta`, `/privacidade`, `/healthz`,
  `/admin/login`, `/admin` + 9 subtelas.
- **Públicas:** `/api/agenda/servicos|dias|horarios|lock|lock/renovar|lock/liberar|cadastro|confirmar`,
  `/api/auth/{admin,cliente}/login`, `/api/auth/logout`.
- **Cliente:** `/api/cliente/me|agendamentos|agendamentos/:id/cancelar|:id/remarcar`.
- **Admin:** `/api/admin/{dashboard,agendamentos(+/:id/status,+POST),disponibilidade,bloqueios,servicos,clientes(+/:id,+/:id/anonimizar),comissoes,configuracao,templates,mensagens(+/enviar)}`.
- **Webhooks:** `GET/POST /webhooks/whatsapp`.
- Contrato de erro: `{ erro: 'CODIGO' }` (+`campos` em `VALIDACAO`); tabela
  `CODIGO → HTTP` de `src/http/erros.js`.
- Eventos Socket.io: as 6 do §6 do doc-pai, com sala e payload.

Revisão de conteúdo; sem teste. (Opcional: um teste que varre `src/routes/*.js`
por `.get(`/`.post(` etc. e falha se uma rota não estiver no `API.md` — só se
for barato; senão, nota de manutenção no topo do arquivo.)

## 9. `docs/whatsapp-templates.md` (Tarefa 7)

Para cada um dos 3 (`confirmacao`, `lembrete_24h`, `pos_atendimento`):
- **Nome** (snake_case, como no seed), **Categoria** Meta (`UTILITY`),
  **Idioma** `pt_BR`.
- **Corpo** com os placeholders da Meta (`{{1}}`, `{{2}}`, …) e o texto fixo
  igual ao seed.
- **Mapa de variáveis:** `{{1}} = nome_cliente`, etc. — a ordem em que o código
  passaria os parâmetros ao enviar via *template message* (hoje o driver manda
  *text* livre; a doc prepara a migração para *template* aprovado).
- **Exemplo preenchido** (o que a Meta pede no formulário de submissão).
- Nota: enquanto o template não é aprovado, o driver `simulado` grava em
  `mensagens_whatsapp` sem enviar; com credencial + `type:'text'` funciona
  dentro da janela de 24h de atendimento; fora da janela exige template
  aprovado.

Teste (`test/services/templates-meta.test.js`): lê os 3 do seed
(`TEMPLATES` em `src/db/seed.js`), extrai `{{\w+}}`, afirma que o conjunto ⊆
`{nome_cliente, nome_servico, data, horario, endereco_barbearia, nome_barbearia}`,
e que `renderizarTemplate(corpo, varsCompletas)` não deixa `{{` no resultado.

## 10. `.github/workflows/ci.yml` (Tarefa 8)

```yaml
name: CI
on:
  push: { branches: [main] }
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:17
        env: { POSTGRES_PASSWORD: postgres, POSTGRES_DB: barbearia_test }
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready -U postgres" --health-interval 5s
          --health-timeout 5s --health-retries 10
    env:
      DATABASE_URL: postgres://postgres:postgres@localhost:5432/barbearia_test
      TEST_SCHEMA: test
      SESSION_SECRET: ci-secret-0000000000000000000000000000000000
      ADMIN_EMAIL: dono@teste.local
      ADMIN_SENHA: teste123456
      NODE_ENV: test
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: npm }
      - run: npm ci
      - run: printf '' > .env && printf '' > .env.test   # npm test faz --env-file dos dois
      - run: npm test
```

- `npm test` = `node --env-file=.env --env-file=.env.test --test ...`. `--env-file`
  aceita arquivo vazio; as env vars vêm do `env:` do job. Confirmar esse
  comportamento do Node 24 ao escrever a tarefa; se `--env-file` exigir arquivo
  existente e não-vazio, os dois `printf` já resolvem (arquivo existe, vazio).
- O container `postgres:17` dá `UNIQUE NULLS NOT DISTINCT` (≥ 15) e um schema
  `test` novo por run — **sem** a fragilidade do schema remoto compartilhado.
- Teste desta tarefa: não há assert de runtime; validar que o YAML parseia
  (`node -e "require('yaml')"` não está disponível — usar um parser simples ou
  `python -c` se houver; senão, revisão manual + `actionlint` se instalado).
  Registrar no relatório que o gate real é o primeiro push.

## 11. README (Tarefa 9)

Reescrever o topo ("P1: Fundação") para: o que é o sistema, stack, as 4 fases
(com link para cada spec/plano em `docs/superpowers/`), setup local
(`.env`/`.env.test`, `npm ci`, `npm run db:reset`, `npm run dev`), comandos,
pointer para `docs/DEPLOY.md` e `docs/API.md`, nota sobre o schema `test`
compartilhado em dev e como o CI evita isso. Revisão de conteúdo.

## 12. Endurecimento de produção (Tarefa 10)

Confirmar (a maioria já está feita) e documentar:
- **Cookie `secure`:** `src/auth/sessao.js` já usa
  `config.NODE_ENV === 'production' || config.COOKIE_SECURE === '1'`. OK.
- **`trust proxy`:** `src/app.js` já tem `app.set('trust proxy', 1)`. OK.
- **`ORIGENS_PERMITIDAS`:** `exigirOrigemConfiavel` usa; documentar que em prod
  deve valer `APP_URL`. Verificar o comportamento com a env vazia (libera
  localhost — ok em dev, **não** em prod: a doc do DEPLOY exige preencher).
- **HSTS / headers:** `helmet` liga HSTS por padrão; a CSP do P3 está ativa. OK.
- **Shutdown gracioso:** `src/server.js` já trata SIGTERM/SIGINT → `parar()`
  (fecha cron, io, server, pool). OK.
- **Pool do banco:** confirmar `max`/`idleTimeout` sensatos em `src/db/pool.js`
  para o plano do Render (poucas conexões) e para o Session Pooler do Supabase.
  Ajuste só se estiver claramente errado; senão documentar os valores.
- Entrega: um teste pequeno (`test/config/*` ou estende um existente) afirmando
  que `criarSessaoMiddleware()` com `NODE_ENV!==production` e `COOKIE_SECURE`
  vazio produz cookie `secure:false`, e com `COOKIE_SECURE='1'` produz
  `secure:true` — para travar o comportamento. O resto é doc.

---

## 13. Estratégia de testes

`node:test` + `--test-concurrency=1`, como P1–P3. Novos testes:
`migrate-004`, `bootstrap` (idempotência), `admin-novo-agendamento` (supertest,
cliente novo/existente/409), `env-example` (parse + cobertura do schema),
`templates-meta` (variáveis conhecidas + render limpo), cookie `secure`
por env. `DEPLOY.md`/`API.md`/`README`/`ci.yml` não têm teste automatizado —
revisão de conteúdo na review de tarefa e na review final.

Alvo: suíte continua verde (183 hoje) + os novos.

---

## 14. Impacto em P1–P3

- `src/server.js`: só o bloco entrypoint ganha `await inicializar(...)`.
  `criarServidor()`, `buildApp()`, motor de agenda, rotas `/api` — intactos.
- `package.json`: `start` inalterado (o boot agora migra/semeia via
  `server.js`); talvez `db:setup`.
- Nova migração `004` — forward-only, roda sozinha no próximo start/CI.
- `admin/agendamentos.ejs` + `admin/agendamentos.js` crescem com o formulário;
  nenhuma outra tela muda.
- `.env.example`/`.env.test.example`/`README.md` — conteúdo.
- Nenhuma mudança em `src/app.js`, `src/agenda/*`, `src/services/*`,
  `src/repos/*`.

## 15. Depois do P4 (fora do núcleo)

WhatsApp/Twilio ao vivo quando o cliente tiver as contas; feature de OTP;
cron de lembrete 24h + pós-atendimento; escolha de profissional na UI e agenda
por barbeiro; PDF/Excel de comissões; PWA; upload/otimização de imagens da
galeria; `git push` para um remote e ativação do CI.
