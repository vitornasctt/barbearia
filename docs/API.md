# Referência de API

> Gerado a partir de `src/routes/*.js` — manter em sincronia ao adicionar rotas.

Todas as respostas de API são JSON. Erros seguem o **Contrato de erro** (seção 7).
Rotas sob `/api/*` passam por `anexarSessaoAnonima` + `exigirOrigemConfiavel`
(este último só barra métodos não-seguros: `POST/PATCH/PUT/DELETE` sem `Origin`/`Referer`
confiável recebem `403 SEM_PERMISSAO`). Prefixos e guardas vêm de `src/app.js`.

| Prefixo | Guardas (`src/app.js`) |
| --- | --- |
| `/` (páginas) | — |
| `/healthz` | — |
| `/api/auth` | `anexarSessaoAnonima`, `exigirOrigemConfiavel` |
| `/api/agenda` | `anexarSessaoAnonima`, `exigirOrigemConfiavel` |
| `/api/cliente` | + `requireCliente` |
| `/api/admin` | + `requireEquipe` (algumas rotas + `requireAdmin`) |
| `/admin` (páginas) | `paginaEquipe` por rota (exceto `/admin/login`) |
| `/webhooks` | nenhuma (montado antes de `express.json`; corpo raw) |

---

## 1. Páginas (HTML)

Respondem HTML renderizado (`renderPagina` / `renderAdmin`); não JSON.

| Método | Rota | Auth | Corpo / Query | Resposta |
| --- | --- | --- | --- | --- |
| GET | `/` | público | — | HTML `inicio` (`Cache-Control: private, max-age=300`) |
| GET | `/agendar` | público | — | HTML `agendar` (lista de serviços, antecedência, intervalo) |
| GET | `/minha-conta` | público | — | HTML `minha-conta` |
| GET | `/privacidade` | público | — | HTML `privacidade` |
| GET | `/healthz` | público | — | `200 { ok: true, db: true }` · `503 { ok: false, db: false }` |
| GET | `/admin/login` | público | — | HTML `login`; `302 → /admin` se já for equipe |
| GET | `/admin` | redirect se não-equipe | — | HTML `dashboard` (`Cache-Control: no-store`) |
| GET | `/admin/agendamentos` | redirect se não-equipe | — | HTML `agendamentos` |
| GET | `/admin/meses` | redirect se não-equipe | — | HTML `meses` (Agenda / Meses) |
| GET | `/admin/bloqueios` | redirect se não-equipe | — | HTML `bloqueios` |
| GET | `/admin/servicos` | redirect se não-equipe | — | HTML `servicos` |
| GET | `/admin/clientes` | redirect se não-equipe | — | HTML `clientes` |
| GET | `/admin/comissoes` | redirect se não-equipe | — | HTML `comissoes` |
| GET | `/admin/configuracao` | redirect se não-equipe | — | HTML `configuracao` |
| GET | `/admin/templates` | redirect se não-equipe | — | HTML `templates` |
| GET | `/admin/mensagens` | redirect se não-equipe | — | HTML `mensagens` |

"redirect se não-equipe" = `paginaEquipe` → `302 /admin/login?next=<url>` quando a sessão não é de equipe válida.

O `Cache-Control: no-store` anotado em `GET /admin` aplica-se a **todas** as rotas `/admin/*` — o middleware está montado no router inteiro, não só em `/admin`.

---

## 2. Auth

Prefixo `/api/auth`.

| Método | Rota | Auth | Corpo / Query | Resposta |
| --- | --- | --- | --- | --- |
| POST | `/api/auth/admin/login` | público (rate-limit por IP + credencial) | `{ email: string(email), senha: string(min 1) }` | `200 { usuario: { id, nome, role } }` · `401 CREDENCIAIS_INVALIDAS` |
| POST | `/api/auth/cliente/login` | público (rate-limit por IP + credencial) | `{ celular: string(min 1), senha: string(min 1) }` | `200 { cliente: { id, nome } }` · `401 CREDENCIAIS_INVALIDAS` |
| POST | `/api/auth/logout` | público | — | `204` (sessão destruída) |

Login de equipe regenera a sessão e grava `usuarioId`, `role`, `equipeExpiraEm` (+12 h).

---

## 3. Agenda pública

Prefixo `/api/agenda`. `GET` sem auth; `POST` exige `Origin` confiável.

| Método | Rota | Auth | Corpo / Query | Resposta |
| --- | --- | --- | --- | --- |
| GET | `/api/agenda/servicos` | público | — | `{ servicos: [...] }` (serviços ativos) |
| GET | `/api/agenda/dias` | público | query: `{ ano:int, mes:int(1-12), servico_id:int>0, barbeiro_id?:int>0 }` | `{ dias: ["YYYY-MM-DD"], fechado: null \| "MES_FECHADO" }` |
| GET | `/api/agenda/horarios` | público | query: `{ data:YYYY-MM-DD, servico_id:int>0, barbeiro_id?:int>0 }` | `{ horarios: ["HH:MM"], fechado: string\|null }` |
| POST | `/api/agenda/lock` | sessão anônima | `{ data:YYYY-MM-DD, horario:"HH:MM", servico_id:int>0, barbeiro_id?:int>0 }` | `200 { ok: true, expira_em: ISO }` · erro `HORARIO_INDISPONIVEL` / `SLOT_TRAVADO` / `SLOT_OCUPADO` |
| POST | `/api/agenda/lock/renovar` | sessão anônima (dona do lock) | mesmo corpo de `/lock` | `200 { ok: true, expira_em: ISO }` · `409 LOCK_EXPIRADO` |
| POST | `/api/agenda/lock/liberar` | sessão anônima (dona do lock) | mesmo corpo de `/lock` | `200 { ok: true }` |
| POST | `/api/agenda/cadastro` | público | `{ nome:string(1-100), celular:string(min 1), email?:string(email), senha?:string(min 6), consentimento: true }` | `201 { cliente: { id, nome } }` · `409 CELULAR_EM_USO` · `400 VALIDACAO` (celular inválido; `email` obrigatório com `senha`) |
| POST | `/api/agenda/confirmar` | `requireCliente` | `{ servico_id:int>0, data:YYYY-MM-DD, horario:"HH:MM", observacoes?:string(max 1000), barbeiro_id?:int>0 }` | `201 { agendamento: {...} }` · erro do fluxo de agendamento (`HORARIO_INDISPONIVEL`, `LOCK_EXPIRADO`, `ANTECEDENCIA`, ...) |

`lock` TTL = 5 min. `cadastro` loga o cliente na sessão. `confirmar` emite eventos Socket.io e dispara o worker de mensagens.
`barbeiro_id` omitido → `configuracao.barbeiro_padrao_id`.

---

## 4. Cliente

Prefixo `/api/cliente`. Todas exigem `requireCliente` (`401 NAO_AUTENTICADO` sem sessão de cliente).

| Método | Rota | Auth | Corpo / Query | Resposta |
| --- | --- | --- | --- | --- |
| GET | `/api/cliente/me` | `requireCliente` | — | `{ cliente: { id, nome, celular, email, celular_verificado } }` |
| GET | `/api/cliente/agendamentos` | `requireCliente` | query: `{ quando: "futuros" \| "historico" }` (default `futuros`) | `{ agendamentos: [...] }` |
| POST | `/api/cliente/agendamentos/:id/cancelar` | `requireCliente` (dono) | `{ motivo?:string(max 500) }` | `{ agendamento: {...} }` · `404 NAO_ENCONTRADO` · `403 FORA_DO_PRAZO` (dentro da antecedência mínima) · erro do fluxo (`JA_CANCELADO`, ...) |
| POST | `/api/cliente/agendamentos/:id/remarcar` | `requireCliente` (dono) | `{ nova_data:YYYY-MM-DD, novo_horario:"HH:MM" }` | `{ agendamento: {...} }` · `404 NAO_ENCONTRADO` · erro do fluxo (`HORARIO_INDISPONIVEL`, ...) |

`:id` que não pertence ao cliente da sessão → `404 NAO_ENCONTRADO`.

---

## 5. Admin

Prefixo `/api/admin`. Base: `requireEquipe` (`401 NAO_AUTENTICADO`). Rotas marcadas **+admin** somam `requireAdmin` (`403 SEM_PERMISSAO` para `role` ≠ `admin`).

| Método | Rota | Auth | Corpo / Query | Resposta |
| --- | --- | --- | --- | --- |
| GET | `/api/admin/dashboard` | equipe | — | `{ hoje: [...], contadores: { cortes_hoje, agendamentos_mes, faturamento_mes, comissao_mes } }` |
| GET | `/api/admin/agendamentos` | equipe | query: `{ data?, de?, ate? (YYYY-MM-DD), status? ("pendente"\|"confirmado"\|"concluido"\|"cancelado"), cliente?:string, page:int>0=1 }` | `{ itens, total, page, ... }` de `agendamentos.listar` |
| POST | `/api/admin/agendamentos` | equipe | `{ cliente_id?:int>0, cliente?:{ nome, celular }, servico_id:int>0, data:YYYY-MM-DD, horario:"HH:MM", barbeiro_id?:int>0, observacoes?:string(max 1000) }` (exige `cliente_id` **ou** `cliente`) | `201 { agendamento: {...} }` · `400 VALIDACAO` · erro do fluxo |
| PATCH | `/api/admin/agendamentos/:id/status` | equipe | `{ status: "confirmado"\|"concluido"\|"cancelado", motivo?:string(max 500) }` | `{ agendamento: {...} }` · `404 NAO_ENCONTRADO` · erro do fluxo. `concluido` enfileira template `pos_atendimento`. |
| GET | `/api/admin/disponibilidade` | equipe | query: `{ ano:int, barbeiro_id?:int>0 }` | `{ meses: [...] }` |
| POST | `/api/admin/disponibilidade` | equipe | `{ ano:int, mes:int(1-12), status:"aberto"\|"fechado", limite_por_dia?:int>=0\|null, barbeiro_id?:int>0 }` | `{ mes: {...} }` (limpa cache) |
| GET | `/api/admin/bloqueios` | equipe | query: `{ de:string, ate:string, barbeiro_id?:int>0 }` | `{ bloqueios: [...] }` |
| POST | `/api/admin/bloqueios` | equipe | `{ data:YYYY-MM-DD, dia_inteiro:bool=false, hora_inicio?:"HH:MM", hora_fim?:"HH:MM", motivo?:string(max 200), barbeiro_id?:int>0 }` | `201 { bloqueio: {...} }` |
| DELETE | `/api/admin/bloqueios/:id` | equipe | — | `204` · `404 NAO_ENCONTRADO` |
| GET | `/api/admin/servicos` | equipe | — | `{ servicos: [...] }` (todos, inclui inativos) |
| POST | `/api/admin/servicos` | equipe | `{ nome:string(1-100), duracao_minutos:int>0, preco:number>=0, comissao_percentual:number(0-100) }` | `201 { servico: {...} }` |
| PATCH | `/api/admin/servicos/:id` | equipe | `{ nome?, duracao_minutos?, preco?, comissao_percentual?, ativo?:bool }` (todos opcionais) | `{ servico: {...} }` · `404 NAO_ENCONTRADO` |
| DELETE | `/api/admin/servicos/:id` | equipe | — | `{ modo }` (hard-delete ou desativação) · `404 NAO_ENCONTRADO` |
| GET | `/api/admin/clientes` | equipe | query: `{ busca?:string, page:int>0=1 }` | `{ itens, total, page }` |
| GET | `/api/admin/clientes/:id` | equipe | — | `{ cliente, agendamentos }` · `404 NAO_ENCONTRADO` |
| POST | `/api/admin/clientes/:id/anonimizar` | **+admin** | — | `{ ok: true }` · `404 NAO_ENCONTRADO` |
| GET | `/api/admin/comissoes` | equipe | query: `{ ano:int, mes:int(1-12), barbeiro_id?:int>0 }` | relatório de `comissoes.relatorio` |
| GET | `/api/admin/configuracao` | equipe | — | objeto de configuração |
| PUT | `/api/admin/configuracao` | **+admin** | `{ nome_barbearia?:string(max 120), endereco?:string, latitude?:number\|null, longitude?:number\|null, telefone_whatsapp?:string(max 20), intervalo_minutos?:int>0, antecedencia_min_horas?:int>=0, limite_dias_futuros?:int>0, expediente?: [{ dia_semana:int(0-6), aberto:bool, abre:string, fecha:string }] × 7 }` | configuração atualizada (limpa cache) |
| GET | `/api/admin/templates` | equipe | — | `{ templates: [...] }` |
| PUT | `/api/admin/templates/:chave` | equipe | `{ titulo:string(1-100), corpo:string(min 1), ativo:bool }` | `{ template: {...} }` · `404 NAO_ENCONTRADO` |
| GET | `/api/admin/mensagens` | equipe | query: `{ agendamento_id?:int>0, status?:string, page:int>0=1 }` | `{ itens, ... }` de `mensagens.listar` |
| POST | `/api/admin/mensagens/enviar` | equipe (rate-limit `limiteMensagens`) | `{ agendamento_id:int>0, template_chave:string(min 1) }` | `202 { mensagem: {...} }` · `404 NAO_ENCONTRADO` · `422 TEMPLATE_INATIVO` |

Observação vs. plano: no código só `anonimizar` e `PUT /configuracao` usam `requireAdmin`. `PATCH /templates/:chave` **não** exige admin (é `PUT`, não `PATCH`, e sem `requireAdmin`).

---

## 6. Webhooks

Prefixo `/webhooks`. Sem sessão; corpo lido como raw (`express.raw`).

| Método | Rota | Auth | Corpo / Query | Resposta |
| --- | --- | --- | --- | --- |
| GET | `/webhooks/whatsapp` | handshake Meta | query: `hub.mode`, `hub.verify_token`, `hub.challenge` | `404` se `WHATSAPP_VERIFY_TOKEN` ausente · `200` ecoa `hub.challenge` quando `hub.mode=subscribe` e token confere · `403` caso contrário |
| POST | `/webhooks/whatsapp` | HMAC `x-hub-signature-256` | corpo raw (JSON WhatsApp Cloud API) | `404` se `WHATSAPP_APP_SECRET` ausente · `403` se assinatura (`sha256=` HMAC-SHA256 do raw com `WHATSAPP_APP_SECRET`) não confere · `200` caso contrário |

`POST` age sobre respostas de texto `SIM` / `NAO` / `NÃO` do cliente: `SIM` confirma o último agendamento
`pendente`/`confirmado` daquele celular; `NAO`/`NÃO` cancela. Emite `agendamento_atualizado`,
`agenda_atualizada`, `dashboard_tick` e invalida cache. JSON inválido → `200` (sem ação).

---

## 7. Contrato de erro

Corpo de erro de API:

```json
{ "erro": "CODIGO" }
```

Para `VALIDACAO` (schema zod de corpo/query), acrescenta:

```json
{ "erro": "VALIDACAO", "campos": [{ "caminho": "campo.aninhado", "mensagem": "..." }] }
```

Código desconhecido / exceção não tratada → `500 { "erro": "ERRO_INTERNO" }`.
Rota não encontrada sob `/api` ou `/webhooks` → `404 { "erro": "NAO_ENCONTRADO" }`.

Tabela `CODIGO → HTTP` (cópia de `src/http/erros.js` `mapaErroHttp`):

| Código | HTTP |
| --- | --- |
| `VALIDACAO` | 400 |
| `NAO_AUTENTICADO` | 401 |
| `CREDENCIAIS_INVALIDAS` | 401 |
| `SEM_PERMISSAO` | 403 |
| `FORA_DO_PRAZO` | 403 |
| `FORA_DO_EXPEDIENTE` | 422 |
| `NAO_ENCONTRADO` | 404 |
| `HORARIO_INDISPONIVEL` | 409 |
| `SLOT_TRAVADO` | 409 |
| `SLOT_OCUPADO` | 409 |
| `LOCK_EXPIRADO` | 409 |
| `JA_CANCELADO` | 409 |
| `JA_CONCLUIDO` | 409 |
| `CELULAR_EM_USO` | 409 |
| `MES_FECHADO` | 422 |
| `DIA_FECHADO` | 422 |
| `ANTECEDENCIA` | 422 |
| `LIMITE_ATINGIDO` | 422 |
| `SERVICO_INVALIDO` | 422 |
| `TEMPLATE_INATIVO` | 422 |
| `MUITAS_TENTATIVAS` | 429 |

---

## 8. Eventos Socket.io

Servidor → cliente. Salas: `agenda:<YYYY-MM-DD>` (por dia) e `admin` (equipe).
Emissores em `src/realtime/emitir.js`; nomes em `src/realtime/eventos.js`.

| Evento | Sala | Quando | Payload |
| --- | --- | --- | --- |
| `horario_reservado` | `agenda:<data>` | `POST /api/agenda/lock` cria um lock | `{ data, horario }` |
| `horario_liberado` | `agenda:<data>` | `POST /api/agenda/lock/liberar` | `{ data, horario }` |
| `agenda_atualizada` | `agenda:<data>` | agendamento criado/alterado que afeta o dia: `confirmar`, cliente cancelar/remarcar, admin criar / `PATCH status`, webhook SIM/NÃO | `{ data }` |
| `novo_agendamento` | `admin` | `POST /api/agenda/confirmar` e `POST /api/admin/agendamentos` | `{ id, cliente, servico, data, horario, status }` |
| `agendamento_atualizado` | `admin` | cliente cancelar, admin `PATCH .../status`, webhook SIM/NÃO | `{ id, status }` |
| `dashboard_tick` | `admin` | qualquer mudança que reconte o dashboard (criar / cancelar / remarcar / concluir / webhook) | `{ cortes_hoje, agendamentos_mes, faturamento_mes, comissao_mes }` |

**Cliente → servidor:**

- `emit('entrar_agenda', { data })` — entra na sala `agenda:<data>` (sai das salas `agenda:*` anteriores); ignora `data` inválida.
- `emit('sair_agenda')` — sai de todas as salas `agenda:*`.

**Sala `admin`:** entrada automática na conexão quando a sessão tem `usuarioId` e `role` `admin` ou `barbeiro` (`src/realtime/io.js`). Não há evento de cliente para entrar nela.
