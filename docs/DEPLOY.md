# Deploy

Guia de deploy do sistema de barbearia. Dois caminhos:

- **Render** — caminho principal, recomendado. Deploy a partir do repositório, TLS e domínio automáticos, sem servidor para administrar.
- **VPS** — alternativa mais barata, com PM2 + nginx + Certbot, sob manutenção do cliente.

O aplicativo é um processo Node único (Express + Socket.io). O cron (`node-cron`) roda **dentro** do processo — limpeza de locks e fila de mensagens do WhatsApp, a cada minuto. Não há worker ou container separado.

---

## Pré-requisitos

- **Node ≥ 22 (repo fixa 24 no `.nvmrc`).** `package.json` declara `engines.node` `>=22`. Use 22 ou mais recente; 24 é o alvo testado (CI roda em 24). O `npm start` usa `--env-file-if-exists=.env`: lê `.env` se existir; em PaaS as variáveis vêm do painel.
- **PostgreSQL ≥ 15.** A migração `004` usa `UNIQUE NULLS NOT DISTINCT`, sintaxe introduzida no PostgreSQL 15. Bancos < 15 falham ao aplicar as migrações e o start aborta. Supabase é 17; a instância do Render e a do VPS devem ser ≥ 15.

### `npm start` aplica migrações + seed automaticamente

Desde o P4, `npm start` (`node --env-file=.env src/server.js`) executa `inicializar({ semear: true })` **antes** de começar a aceitar requisições:

1. aplica todas as migrações pendentes (`src/db/migrate.js`);
2. roda o seed idempotente (`src/db/seed.js` — tudo com `ON CONFLICT DO NOTHING`; o admin usa `ON CONFLICT (email) DO UPDATE` que **não** sobrescreve senha).

Ou seja: **não existe passo manual de `db:migrate` no deploy**. Basta `npm ci` + `npm start`. Se uma migração falhar, o processo sai com código ≠ 0 e o start é abortado (no Render isso mantém a versão anterior no ar).

### Health check

`GET /healthz` responde:

- `200 {"ok":true,"db":true}` quando o pool do banco responde;
- `503 {"ok":false,"db":false}` quando não responde.

### Shutdown gracioso

`src/server.js` trata `SIGTERM` e `SIGINT`: para o cron, fecha o Socket.io, encerra o servidor HTTP e drena o pool do banco. Render envia `SIGTERM` em cada deploy; PM2 idem.

---

## Render (caminho principal)

### 1. Banco de dados

Duas opções:

- **Render PostgreSQL (≥ 15):** crie um banco no dashboard do Render. Copie a **Internal Database URL** (host interno `...-a`, sem SSL obrigatório entre serviços do mesmo região). Essa string vai em `DATABASE_URL`.
- **Manter o Supabase existente:** use a connection string do **Session Pooler** (porta **5432**), não a Direct Connection. Se a senha tiver caractere especial (`@`, `:`, `/`, `#`, …), faça **percent-encode** dela na URL. Exemplo:

  ```
  postgresql://postgres.<project-ref>:<senha-encoded>@aws-0-<regiao>.pooler.supabase.com:5432/postgres
  ```

### 2. Web Service

No dashboard do Render, **New → Web Service**, conecte o repositório e configure:

| Campo | Valor |
|---|---|
| Runtime | Node |
| Build Command | `npm ci` |
| Start Command | `npm start` |
| Health Check Path | `/healthz` |

O `npm start` aplica migrações + seed e sobe o servidor (ver "Pré-requisitos" acima). O `prestart`/`postinstall` (`scripts/sync-vendor.js`) roda sozinho.

### 3. Variáveis de ambiente

Adicione em **Environment** do Web Service. Lista completa (base em `.env.example`):

#### Obrigatórias

| Var | Valor de produção |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `3000` (ou deixe o Render injetar; o app respeita `PORT`) |
| `TZ` | `America/Sao_Paulo` |
| `DATABASE_URL` | a URL interna do passo 1 |
| `SESSION_SECRET` | 64 hex aleatórios — gere com o one-liner abaixo |
| `APP_URL` | `https://<seu-dominio>` (o domínio público final) |
| `ADMIN_EMAIL` | e-mail do dono (login inicial do painel) |
| `ADMIN_SENHA` | senha inicial do dono — **troque no primeiro login** em `/admin` |

Gerar `SESSION_SECRET`:

```bash
node -e "console.log(crypto.randomBytes(32).toString('hex'))"
```

#### Produção (atrás do proxy TLS do Render)

| Var | Valor |
|---|---|
| `COOKIE_SECURE` | `1` |
| `ORIGENS_PERMITIDAS` | `https://<seu-dominio>` (mesmo valor de `APP_URL`) |

O cookie de sessão já vira `Secure` quando `NODE_ENV=production`; setar `COOKIE_SECURE=1` deixa explícito. `app.set('trust proxy', 1)` já está no código, então os headers `X-Forwarded-*` do Render são respeitados. **`ORIGENS_PERMITIDAS` vazio ⇒ só `APP_URL` é aceito (recomendado, é o mais restrito).** Use esta variável apenas para **origens adicionais** — ex. um domínio alternativo — em CSV.

#### Opcionais

| Var | Observação |
|---|---|
| `GOOGLE_MAPS_API_KEY` | chave do mapa da página de agendamento; o cliente já tem |
| `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TOKEN`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` | bloco WhatsApp Cloud API. **Todas vazias ⇒ modo simulado** (mensagens gravadas em `mensagens_whatsapp`, nada enviado). Ver "Ativar WhatsApp". |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID` | bloco SMS/OTP. Vazias ⇒ modo simulado. |
| `LOG_LEVEL` | `info` (padrão). `debug` para diagnóstico. |
| `TEST_SCHEMA` | **não setar em produção** — usado só por `npm test`. |

### 4. Versão do Node

O Render lê o `.nvmrc` do repositório e usa **Node 24**. Não é preciso setar `NODE_VERSION`. Se quiser fixar por env var, use `24`.

### 5. Cron

O `node-cron` roda dentro do processo do Web Service: limpeza de locks expirados e envio da fila de mensagens do WhatsApp, a cada minuto. **Não é preciso** contratar um Render Cron Job pago para isso.

Opcional (nice-to-have): um **Render Cron Job** diário rodando `pg_dump` para um bucket externo, como backup independente do snapshot do Render. Ver "Backup e rollback".

### 6. Domínio customizado

Em **Settings → Custom Domains** do Web Service, adicione o domínio e siga as instruções de DNS. O Render provisiona o certificado TLS automaticamente (Let's Encrypt).

Depois que o domínio estiver ativo, **atualize**:

- `APP_URL` → `https://<seu-dominio>`
- `ORIGENS_PERMITIDAS` → `https://<seu-dominio>`

e faça um novo deploy (mudança de env var já dispara um).

### 7. Webhook do WhatsApp (quando for ativar)

No painel da Meta (WhatsApp → Configuration → Webhook), cadastre:

- **Callback URL:** `https://<APP_URL>/webhooks/whatsapp`
- **Verify token:** o mesmo valor que você colocou em `WHATSAPP_VERIFY_TOKEN`

O `GET /webhooks/whatsapp` já responde o `hub.challenge` da Meta quando `WHATSAPP_VERIFY_TOKEN` está setado. O `POST` valida o header `x-hub-signature-256` com `WHATSAPP_APP_SECRET`. Assine os campos `messages` que precisar.

---

## Custo aproximado (Render)

| Item | Plano | Preço |
|---|---|---|
| Web Service | Starter | US$ 7/mês |
| PostgreSQL | Basic | US$ 7/mês |
| **Total** | | **≈ US$ 14/mês** |

O **free tier valida** o deploy, mas o Web Service **dorme** após ~15 min de inatividade e leva alguns segundos para acordar na primeira requisição — e o **WebSocket cai junto** quando o serviço hiberna, então o tempo real do painel não é confiável no free. Para produção, use o Starter.

---

## Alternativa: VPS

Servidor Ubuntu 22.04+ (qualquer provedor — Hetzner, DigitalOcean, etc.). Custo típico **~€4–5/mês**. Manutenção (patches de SO, renovação de disco, monitoração) fica com o cliente.

### 1. Node 20 LTS

Via nvm:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
# reabra o shell
nvm install 24 && nvm alias default 24
```

Ou via NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### 2. PostgreSQL ≥ 15

```bash
sudo apt-get install -y postgresql
psql --version   # confirme >= 15
```

Crie banco e usuário:

```bash
sudo -u postgres psql <<'SQL'
CREATE USER barbearia WITH PASSWORD 'senha-forte-aqui';
CREATE DATABASE barbearia OWNER barbearia;
SQL
```

`DATABASE_URL` local: `postgresql://barbearia:senha-forte-aqui@127.0.0.1:5432/barbearia`

### 3. Código e dependências

```bash
sudo apt-get install -y git
git clone <url-do-repo> /opt/barbearia
cd /opt/barbearia
npm ci
```

### 4. Arquivo `.env`

Crie `/opt/barbearia/.env` a partir de `.env.example`. Em produção, no mínimo:

```bash
NODE_ENV=production
PORT=3000
TZ=America/Sao_Paulo
DATABASE_URL=postgresql://barbearia:senha-forte-aqui@127.0.0.1:5432/barbearia
SESSION_SECRET=<64 hex — node -e "console.log(crypto.randomBytes(32).toString('hex'))">
APP_URL=https://seu-dominio
ADMIN_EMAIL=dono@barbearia.com
ADMIN_SENHA=troque-no-primeiro-login
COOKIE_SECURE=1
ORIGENS_PERMITIDAS=https://seu-dominio
LOG_LEVEL=info
```

`COOKIE_SECURE=1` é **obrigatório** aqui (o TLS termina no nginx, então o Node não sabe sozinho que a conexão é HTTPS). `ORIGENS_PERMITIDAS` vazio ⇒ só `APP_URL` é aceito (recomendado). Use a variável apenas para **origens adicionais** — ex. um domínio alternativo — em CSV.

### 5. Rodar sob PM2

```bash
npm install -g pm2
pm2 start "npm run start" --name barbearia
pm2 save
pm2 startup   # execute o comando que ele imprimir (systemd)
```

O primeiro start aplica migrações + seed. Logs: `pm2 logs barbearia`.

### 6. nginx como reverse proxy

`/etc/nginx/sites-available/barbearia`:

```nginx
server {
    listen 80;
    server_name seu-dominio;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Os headers `Upgrade`/`Connection` são necessários para o WebSocket do Socket.io. `X-Forwarded-Proto` é o que faz o Express (com `trust proxy`) tratar a conexão como HTTPS e marcar o cookie como `Secure`.

```bash
sudo ln -s /etc/nginx/sites-available/barbearia /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### 7. TLS com Certbot

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d seu-dominio
```

O Certbot reescreve o bloco do nginx para `listen 443 ssl`, adiciona o redirect de 80 → 443 e instala o cron de renovação.

### 8. Firewall

```bash
sudo ufw allow 22
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable
```

### 9. Backup diário via cron do sistema

```bash
sudo crontab -e
```

```cron
0 3 * * * pg_dump "postgresql://barbearia:senha-forte-aqui@127.0.0.1:5432/barbearia" | gzip > /var/backups/barbearia-$(date +\%F).sql.gz
```

Rotacione os dumps antigos (ex.: `find /var/backups -name 'barbearia-*.sql.gz' -mtime +14 -delete`).

---

## Backup e rollback

- **Backup:** `pg_dump` agendável — Render Cron Job diário ou cron do sistema no VPS (ver acima). O Render Postgres também tem snapshots automáticos por plano, mas um `pg_dump` para armazenamento externo é a garantia independente.
- **Migrações são forward-only e transacionais.** Cada arquivo em `src/db/migrations/` roda uma vez, dentro de uma transação. Não há "down migration". Uma migração que falha faz rollback dela mesma e aborta o start com exit ≠ 0.
- **Rollback de deploy:**
  - *Render:* se o `npm start` falhar (migração quebrada, config inválida — `carregarConfig` já aborta com `SESSION_SECRET` curto ou faltando), o deploy é marcado como falho e **a versão anterior continua no ar**. Para reverter um deploy que subiu mas está ruim, use "Rollback" no dashboard (Deploys → versão anterior → Redeploy).
  - *VPS:* `git checkout <commit-anterior> && npm ci && pm2 restart barbearia`.
- **Rollback de dados / schema:** como as migrações não têm down, reverter uma mudança de schema = **restaurar o dump** anterior à migração. Por isso o backup antes de um deploy com migração nova é importante.

---

## Pós-deploy: banco já existente (seed não faz backfill)

Se o banco já foi semeado durante o desenvolvimento (P1/P2/P3), atenção:

- O seed insere a linha `configuracao` (id fixo) com **`ON CONFLICT (id) DO NOTHING`**. Num banco já semeado, os valores **não são atualizados** pelo start.
- Os valores semeados são **placeholders**: `telefone_whatsapp='5511999990000'`, `endereco='Rua Exemplo, 123 - Sao Paulo'`, `latitude`/`longitude` de exemplo.
- Num banco **novo** de produção, esses placeholders sobem como se fossem conteúdo real.

**Em ambos os casos:** logo após o primeiro deploy, entre em **`/admin/configuracao`** e preencha os valores reais — `telefone_whatsapp`, `endereco`, `latitude`, `longitude` (e o resto da configuração da barbearia). É a tela que grava por cima; o seed não.

Trocar `ADMIN_EMAIL` depois do primeiro deploy cria um **segundo** admin (o upsert é `ON CONFLICT (email)`), não renomeia o primeiro.

---

## Antes do primeiro deploy do P4: de-dup da migração 004

A migração `004_meses_nulls_not_distinct.sql` troca o `UNIQUE` de `agenda_disponibilidade` por `UNIQUE NULLS NOT DISTINCT`. Se o banco-alvo já tiver linhas de "mês global" (`barbeiro_id IS NULL`) duplicadas para o mesmo `(ano, mes)`, o `ADD CONSTRAINT` falha e, como as migrações rodam no boot, o `npm start` aborta.

Antes do primeiro deploy do P4, rode contra o banco-alvo:

```sql
SELECT ano, mes, count(*) FROM agenda_disponibilidade
WHERE barbeiro_id IS NULL GROUP BY ano, mes HAVING count(*) > 1;
```

Se retornar linhas, mantenha só o `id` mais novo de cada `(ano, mes)` e apague o resto antes de subir. (O banco de dev/prod atual foi verificado **vazio** em 2026-09-07 — este deploy é seguro; a checagem vale para outros ambientes: um Postgres de VPS, um dump restaurado.)

---

## Ativar WhatsApp

Enquanto o bloco `WHATSAPP_*` estiver vazio, o driver roda em **modo simulado**: as mensagens são gravadas em `mensagens_whatsapp` e aparecem em `/admin/mensagens`, mas nada é enviado.

Para ativar o envio real (WhatsApp Cloud API da Meta) e o formato dos 3 templates (`confirmacao`, `lembrete_24h`, `pos_atendimento`) no padrão do Gerenciador de Modelos da Meta, siga **[`docs/whatsapp-templates.md`](whatsapp-templates.md)**. Depois preencha as 4 env vars (`WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TOKEN`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`), faça um novo deploy e cadastre o webhook (passo 7 da seção Render).
