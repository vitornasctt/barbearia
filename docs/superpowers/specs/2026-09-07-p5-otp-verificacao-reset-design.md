# Sistema de Barbearia — Spec de Design (P5: OTP de verificação + reset de senha)

- **Data:** 2026-09-07
- **Status:** aprovado para implementação
- **Depende de:** P1 + P2 + P3 + P4 (todos mergeados em `main`)
- **Documento-pai:** `docs/superpowers/specs/2026-09-05-barbearia-nucleo-design.md` (§13 templates, §12 fases; `otp_codigos` marcada "uso na Fase 2")

---

## 1. Escopo

P5 adiciona **verificação de celular por código** e **redefinição de senha**
para a conta de cliente, sem introduzir dependência externa nova: o código
trafega pelo mesmo pipeline de mensagens (`mensagens_whatsapp`) que já
existe, e — como o driver de WhatsApp hoje — cai em modo `simulado` quando
não há credencial. O mecanismo é OTP próprio (código gerado, hash gravado,
verificado localmente), reaproveitando a tabela `otp_codigos` de `001_init`.

### Entra no P5

1. **Migração `005`** — coluna `proposito` em `otp_codigos` (`'cadastro' | 'reset'`)
   e índice `(celular, created_at DESC)` para as consultas de rate-limit.
2. **`src/services/otp.js`** — unidade isolada: `gerarCodigo`, `emitir`,
   `verificar`. Sem I/O de rede; quem chama recebe o código em claro para
   enfileirar a mensagem.
3. **Enfileiramento genérico de mensagem** — extrair de `src/agenda/agendar.js`
   a inserção em `mensagens_whatsapp` para uma função reutilizável que aceita
   `agendamento_id = null` (`src/services/mensagens.js`).
4. **`POST /api/auth/otp/enviar`** — `{ celular, proposito }` → emite código,
   enfileira mensagem `codigo_verificacao`. Responde `200 { enviado: true }`
   sempre (não vaza existência de cadastro).
5. **`POST /api/auth/senha/redefinir`** — `{ celular, codigo, nova_senha }` →
   verifica código de `proposito='reset'`, grava `senha_hash` novo, invalida o
   código, registra em `logs_acesso`, loga a sessão do cliente.
6. **`POST /api/agenda/cadastro` ganha campo opcional `codigo`** — quando
   `senha` está presente, `codigo` passa a ser obrigatório e é verificado
   (`proposito='cadastro'`) antes de criar/atualizar o cliente com
   `senha_hash` **e** `celular_verificado = true`.
7. **Rate limiting** — `storeOtp` novo em `src/auth/rateLimit.js` (incluído no
   `resetRateLimit()`); dois limitadores nas rotas de OTP: por IP+celular
   (3 / 10 min) e por IP (20 / 10 min).
8. **Template `codigo_verificacao`** — novo item no array `TEMPLATES` de
   `src/db/seed.js`. Vars: `{{codigo}}`, `{{nome_barbearia}}`.
9. **Limpeza no cron** — a tarefa `node-cron` existente ganha
   `DELETE FROM otp_codigos WHERE created_at < now() - interval '1 day'`.
10. **UI `/agendar`** — no passo "Seus dados", só quando "Quero criar uma
    senha" está marcado: botão "Enviar código", campo do código, reenvio com
    contador de 60 s; "Continuar" manda `codigo` no corpo do cadastro.
11. **UI `/minha-conta`** — link "Esqueci minha senha" abrindo mini-fluxo de
    3 passos (celular → código → nova senha); ao concluir, cai logado.
12. **Códigos de erro** — `OTP_INVALIDO` (400) em `src/http/erros.js`;
    reaproveita `MUITAS_TENTATIVAS` (429) do rate-limit.

### Não entra no P5 (follow-ups / fases seguintes)

- **SMS real.** Sem conta Twilio/Meta ativa; o código sai pelo pipeline de
  mensagens e fica `simulado`. As chaves `TWILIO_*` de `src/config.js`
  continuam sem uso. Se um dia um driver de SMS entrar, ele pluga no mesmo
  ponto que o `whatsapp.js` (worker `mensageiro`).
- **Verificação para cadastro anônimo** (só nome+celular, sem senha). Segue
  sem código, como o P2 decidiu — o atrito só entra em quem cria senha.
- **Reset por e-mail / link.** Só código pelo mesmo canal; conta sem
  `celular_verificado` não tem como redefinir senha por aqui (mensagem
  orienta procurar a barbearia).
- **Badge "celular verificado"** em telas fora do fluxo de cadastro
  (dashboard, lista de clientes do admin, etc.).
- **Segundo fator no login** e **expiração de sessão do cliente** — fora de
  escopo; login com senha segue como está.
- **Reenvio com limite dinâmico** além do contador visual de 60 s (o
  rate-limit do servidor é a trava real).

---

## 2. Arquivos

### Novos

| Arquivo | Papel |
|---|---|
| `src/db/migrations/005_otp_proposito.sql` | coluna `proposito` + índice em `otp_codigos` |
| `src/services/otp.js` | emissão/verificação de código |
| `src/services/mensagens.js` | `enfileirarMensagem({ templateChave, telefone, vars, agendamentoId })` |
| `src/repos/otp.js` | acesso a `otp_codigos` (insert, buscar aberto, incrementar tentativa, invalidar) |
| `test/services/otp.test.js` | unidade do serviço OTP |
| `test/http/otp-cadastro.test.js` | cadastro com senha exige código |
| `test/http/reset-senha.test.js` | fluxo de reset |

### Alterados

| Arquivo | Mudança |
|---|---|
| `src/routes/auth.js` | rotas `/otp/enviar` e `/senha/redefinir` |
| `src/routes/publicas.js` | `POST /cadastro` valida `codigo` quando há `senha` |
| `src/agenda/agendar.js` | usa `src/services/mensagens.js` no lugar da inserção inline |
| `src/auth/rateLimit.js` | `storeOtp` + `limiteOtpCelular` + `limiteOtpIp` + `resetRateLimit` |
| `src/http/erros.js` | `OTP_INVALIDO` → 400 |
| `src/db/seed.js` | `TEMPLATES` ganha `codigo_verificacao` |
| `src/server.js` | linha de limpeza de `otp_codigos` na tarefa cron existente |
| `src/views/agendar.ejs` | campos de código no passo 4 |
| `src/public/js/agendar.js` | `enviarCodigo()`, estado do código, `codigo` no cadastro |
| `src/views/minha-conta.ejs` | bloco "Esqueci minha senha" |
| `src/public/js/minha-conta.js` | fluxo de 3 passos do reset |
| `docs/API.md` | novas rotas + `OTP_INVALIDO` |
| `docs/whatsapp-templates.md` | template `codigo_verificacao` |

---

## 3. Migração `005_otp_proposito.sql` (Tarefa 1)

```sql
ALTER TABLE otp_codigos
  ADD COLUMN proposito VARCHAR(20) NOT NULL DEFAULT 'cadastro'
  CHECK (proposito IN ('cadastro','reset'));

CREATE INDEX idx_otp_celular_created ON otp_codigos (celular, created_at DESC);
```

Forward-only, transacional. `otp_codigos` está vazia em qualquer ambiente
(feature nunca usada), então o `DEFAULT` não tem efeito retroativo relevante.
`clientes.celular_verificado`, o restante de `otp_codigos` e o
`agendamento_id` nullable de `mensagens_whatsapp` **já existem** — nada a
mudar neles.

---

## 4. `src/repos/otp.js` (Tarefa 2a)

Acesso puro à tabela, sem regra de negócio:

- `inserir({ celular, proposito, codigoHash, expiraEm }) => Promise<row>`
- `abertoMaisRecente({ celular, proposito }) => Promise<row | undefined>`
  — `verificado=false` ordenado por `created_at DESC LIMIT 1`.
- `incrementarTentativa(id) => Promise<number>` — `RETURNING tentativas`.
- `marcarVerificado(id) => Promise<void>`
- `invalidarAbertos({ celular, proposito }) => Promise<void>` — usado antes de
  emitir um novo (um código vivo por par `celular+proposito`).
- `limparAntigos({ dias = 1 }) => Promise<number>` — para o cron.

---

## 5. `src/services/otp.js` (Tarefa 2b)

```
CODIGO_DIGITOS = 6
EXPIRA_MIN     = 10
MAX_TENTATIVAS = 5

gerarCodigo()                       → String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')

emitir({ celular, proposito })      → invalidarAbertos(); codigo = gerarCodigo();
                                      inserir({ codigoHash: await hashSenha(codigo),
                                                expiraEm: now + EXPIRA_MIN });
                                      return { codigo }        // em claro, só aqui

verificar({ celular, proposito, codigo })
                                    → row = abertoMaisRecente()
                                      se !row                     → { ok:false, erro:'OTP_INVALIDO' }
                                      se now > row.expira_em      → { ok:false, erro:'OTP_INVALIDO' }
                                      se row.tentativas >= MAX    → { ok:false, erro:'OTP_INVALIDO' }
                                      t = await incrementarTentativa(row.id)
                                      se !(await verificarSenha(codigo, row.codigo_hash))
                                                                  → { ok:false, erro:'OTP_INVALIDO' }
                                      await marcarVerificado(row.id)
                                      return { ok:true }
```

- **Hash:** reusa `bcrypt` de `src/auth/senha.js` (`hashSenha`/`verificarSenha`).
  Custo 12 × no máximo 5 tentativas = teto de trabalho aceitável; emissão faz
  1 hash.
- **Erro único:** toda falha de verificação responde `OTP_INVALIDO` — não
  distingue "expirou" de "errado" de "não existe" para o chamador externo (o
  motivo real vai pro log).
- **Consumo único:** `marcarVerificado` fecha o código; uma segunda chamada
  não acha `aberto` e falha.
- **Sem I/O de rede:** o serviço não envia nada. Quem chama `emitir()`
  encaminha `codigo` para `enfileirarMensagem()`.

---

## 6. `src/services/mensagens.js` (Tarefa 3)

Extrai de `src/agenda/agendar.js` a montagem+inserção em `mensagens_whatsapp`,
generalizada:

```
enfileirarMensagem({ templateChave, telefone, vars, agendamentoId = null }, exec = query)
  → tpl = SELECT corpo FROM templates_mensagem WHERE chave=$1 AND ativo
    se !tpl → lança/retorna sem enfileirar (mesma tolerância do código atual)
    texto = renderizarTemplate(tpl.corpo, vars)
    INSERT INTO mensagens_whatsapp (agendamento_id, template_chave, telefone_destino,
                                    mensagem_final, status_envio)
    VALUES ($1, $2, $3, $4, 'pendente')
```

- `exec` opcional para participar de uma transação (o fluxo de agendamento
  passa o `client`); as rotas de OTP chamam com o `query` global.
- `src/agenda/agendar.js` passa a chamar `enfileirarMensagem({ templateChave:
  'confirmacao', telefone: d.celular, vars: {...}, agendamentoId: ag.id }, exec)`
  no lugar do bloco inline de `enfileirarConfirmacao` — comportamento
  idêntico, só realocado.

---

## 7. Rotas OTP — `src/routes/auth.js` (Tarefa 4)

### 7.1 `POST /api/auth/otp/enviar`

```
limiteOtpIp, limiteOtpCelular
corpo: { celular: string, proposito: z.enum(['cadastro','reset']) }

celular = normalizarCelular(body.celular)   // erro de formato → 200 { enviado:true } (não vaza)

se proposito === 'reset':
    c = await clientes.porCelular(celular)
    se !c || !c.senha_hash || !c.celular_verificado:
        return 200 { enviado:true }          // silencioso

{ codigo } = await otp.emitir({ celular, proposito })
nomeBarbearia = (SELECT nome_barbearia FROM configuracao WHERE id=1)   // como em agendar.js
await enfileirarMensagem({
  templateChave: 'codigo_verificacao', telefone: celular,
  vars: { codigo, nome_barbearia: nomeBarbearia },
})
await processarPendentes({ limite: 5 }).catch(log)   // mesmo empurrão do /confirmar
return 200 { enviado:true }
```

Resposta **sempre** `200 { enviado: true }`, com ou sem cadastro, com ou sem
celular bem formado — a única forma de falhar é rate-limit (`429
MUITAS_TENTATIVAS`).

### 7.2 `POST /api/auth/senha/redefinir`

```
limiteOtpIp, limiteOtpCelular
corpo: { celular: string, codigo: /^\d{6}$/, nova_senha: string.min(6) }

celular = normalizarCelular(...)                       // falha → OTP_INVALIDO
r = await otp.verificar({ celular, proposito:'reset', codigo })
se !r.ok → next(ErroHttp('OTP_INVALIDO'))

c = await clientes.porCelular(celular)
se !c || !c.senha_hash || !c.celular_verificado → next(ErroHttp('OTP_INVALIDO'))  // não vaza

await clientes.definirSenha(c.id, await hashSenha(nova_senha))
await logs.registrar({ quem_tipo:'cliente', quem_id:c.id, acao:'senha_redefinida', ip:req.ip })
req.session.clienteId = c.id; delete req.session.usuarioId; delete req.session.role
return 200 { cliente: { id:c.id, nome:c.nome } }
```

`clientes.definirSenha(id, hash)` é um `repo` novo pequeno
(`UPDATE clientes SET senha_hash=$2 WHERE id=$1`).

---

## 8. `POST /api/agenda/cadastro` com `codigo` — `src/routes/publicas.js` (Tarefa 5)

Corpo ganha `codigo: z.string().regex(/^\d{6}$/).optional()`. Lógica nova,
inserida **antes** do `clientes.criar`:

```
existente = await clientes.porCelular(celular)
se existente?.senha_hash → ErroHttp('CELULAR_EM_USO')      // inalterado

se body.senha:
    se !body.codigo → ErroHttp('VALIDACAO', campos:[{caminho:'codigo', ...}])
    r = await otp.verificar({ celular, proposito:'cadastro', codigo: body.codigo })
    se !r.ok → ErroHttp('OTP_INVALIDO')

se existente:                       // existe, sem senha (passou pelo CELULAR_EM_USO)
    cliente = existente
    se body.senha:
        await clientes.definirSenha(cliente.id, await hashSenha(body.senha))
        await clientes.marcarCelularVerificado(cliente.id)
senão:
    cliente = await clientes.criar({
      nome, celular, email: body.email ?? null,
      senha_hash: body.senha ? await hashSenha(body.senha) : null,
      celular_verificado: Boolean(body.senha),
    })
```

- `clientes.criar` ganha o parâmetro `celular_verificado` (default `false`) —
  hoje ele não existe na assinatura.
- `clientes.definirSenha(id, hash)` e `clientes.marcarCelularVerificado(id)`
  são os repos pequenos citados na Tarefa 7.
- O caso "existe com senha" segue barrado por `CELULAR_EM_USO` **antes** de
  qualquer verificação de código — quem já tem conta usa login ou reset.

Fluxo anônimo (sem `body.senha`): nenhuma verificação, `codigo` ignorado —
idêntico ao atual.

---

## 9. Rate limiting — `src/auth/rateLimit.js` (Tarefa 6)

```js
export const storeOtp = new MemoryStore();
// resetRateLimit() passa a chamar storeOtp.resetAll?.()

export const limiteOtpCelular = rateLimit({
  windowMs: 10 * 60_000, limit: 3, store: storeOtp,
  keyGenerator: (req) => `${req.ip}:${req.body?.celular ?? ''}`,
  handler: bloqueio, standardHeaders: 'draft-7', legacyHeaders: false,
});
export const limiteOtpIp = rateLimit({
  windowMs: 10 * 60_000, limit: 20, store: storeOtp,
  keyGenerator: (req) => req.ip,
  handler: bloqueio, standardHeaders: 'draft-7', legacyHeaders: false,
});
```

Aplicados em `/otp/enviar` e `/senha/redefinir`. `test/http/*` que exercitam
essas rotas chamam `resetRateLimit()` no `beforeEach` (padrão já usado em
`admin-paginas.test.js`).

---

## 10. Template `codigo_verificacao` — `src/db/seed.js` (Tarefa 7)

Novo item no array `TEMPLATES` (`[chave, titulo, corpo]`):

```
['codigo_verificacao', 'Código de verificação',
 'Seu código {{codigo}} para {{nome_barbearia}}. Vale por 10 minutos. Não compartilhe com ninguém.']
```

O `INSERT ... WHERE NOT EXISTS` do seed já é idempotente. `docs/whatsapp-templates.md`
ganha a entrada correspondente (categoria **AUTHENTICATION** no Gerenciador da
Meta, corpo com `{{1}}`/`{{2}}`, mapa de variáveis).

---

## 11. Limpeza no cron — `src/server.js` (Tarefa 8)

A tarefa `node-cron` que já roda `limparExpirados()` (locks) + `processarPendentes()`
ganha uma linha:

```js
await otpRepo.limparAntigos({ dias: 1 }).catch((e) => log.error({ e }, 'limpeza otp'));
```

Mesmo intervalo da tarefa existente. Sem novo agendamento de cron.

---

## 12. UI `/agendar` (Tarefa 9)

`src/views/agendar.ejs`, passo 4 ("Seus dados"), dentro do
`<template x-if="form.comSenha">` que já existe:

- linha nova: `<input type="email">` (já existe) + `<input x-model="form.senha">`
  (já existe) + **botão "Enviar código"** (`@click="enviarCodigo()"`,
  `:disabled="reenvioEm > 0"`) com rótulo dinâmico
  (`reenvioEm > 0 ? 'Reenviar em ' + reenvioEm + 's' : 'Enviar código'`)
- `<input x-model="form.codigo" inputmode="numeric" maxlength="6">` com
  `x-show="codigoEnviado"`
- `p.erro-inline` para `OTP_INVALIDO`

`src/public/js/agendar.js`:

- estado: `codigoEnviado: false`, `reenvioEm: 0`, `form.codigo: ''`
- `enviarCodigo()` → `POST /api/auth/otp/enviar { celular: form.celular,
  proposito: 'cadastro' }`; on 200 → `codigoEnviado = true`; inicia contagem
  regressiva de 60 s em `reenvioEm`
- `enviarCadastro()` (já existe) inclui `codigo: form.codigo` no corpo quando
  `form.comSenha`; trata `OTP_INVALIDO` mostrando erro no passo 4 (não avança)

Sem "Quero criar uma senha" marcado: nada disso aparece, cadastro segue
como hoje.

## 13. UI `/minha-conta` (Tarefa 10)

`src/views/minha-conta.ejs`, no bloco `!logado`, abaixo do form de login:

- `<button class="link" @click="modoReset = true">Esqueci minha senha</button>`
- bloco `x-show="modoReset"` com 3 passos (`passoReset` 1→3):
  1. celular → "Enviar código" (`POST /otp/enviar { proposito:'reset' }`)
  2. código (6 dígitos) → "Continuar" (valida formato no cliente; a
     verificação real é no passo 3)
  3. nova senha + confirmar → "Redefinir"
     (`POST /api/auth/senha/redefinir { celular, codigo, nova_senha }`)
- sucesso → `logado = true`, carrega agendamentos, `aba = 'proximos'`,
  `modoReset = false`
- `OTP_INVALIDO` no passo 3 → volta pro passo 2 com mensagem "Código inválido
  ou expirado"

`src/public/js/minha-conta.js` ganha `modoReset`, `passoReset`,
`reset: { celular, codigo, senha, senha2 }`, `enviarCodigoReset()`,
`redefinirSenha()`. Reusa `pedirJson()` já existente.

---

## 14. Códigos de erro — `src/http/erros.js` (Tarefa 11)

`OTP_INVALIDO` → HTTP 400, mensagem pública "Código inválido ou expirado.".
`MUITAS_TENTATIVAS` (429) já existe e cobre o rate-limit. `VALIDACAO` (422)
já cobre `codigo` ausente com `senha` presente.

---

## 15. Estratégia de testes

`node:test`, `npm test` com `--test-concurrency=1` (schema `test` remoto
compartilhado — regra herdada). No CI, `postgres:17` isolado.

### `test/services/otp.test.js`
- `gerarCodigo` → 6 dígitos, com zero à esquerda quando `randomInt` < 100000
- `emitir` grava linha com `verificado=false`, `expira_em ≈ now+10min`,
  hash que confere com o código retornado
- `emitir` de novo invalida o código anterior do mesmo `celular+proposito`
- `verificar` feliz → `{ ok:true }` e linha `verificado=true`
- código errado → `{ ok:false, erro:'OTP_INVALIDO' }` e `tentativas` +1
- 5 erros → 6ª tentativa (mesmo com código certo) → `OTP_INVALIDO`
- código expirado (`expira_em` no passado via update direto) → `OTP_INVALIDO`
- código já verificado não serve de novo
- `proposito` diferente não cruza (código de `cadastro` não verifica `reset`)

### `test/http/otp-cadastro.test.js`
- `POST /api/auth/otp/enviar {proposito:'cadastro'}`, ler o código de
  `mensagens_whatsapp.mensagem_final` (regex `/\b(\d{6})\b/`), então
  `POST /api/agenda/cadastro` com `senha`+`codigo` → `201`, cliente com
  `celular_verificado=true`
- cadastro com `senha` sem `codigo` → `422 VALIDACAO`
- cadastro com `senha` + `codigo` errado → `400 OTP_INVALIDO`, nada criado
- cadastro **sem** `senha` → `201` sem exigir `codigo` (regressão do fluxo
  anônimo)
- reuso do mesmo código num segundo cadastro → `OTP_INVALIDO`

### `test/http/reset-senha.test.js`
- cria cliente com senha + `celular_verificado=true`; `otp/enviar
  {proposito:'reset'}`; lê código; `senha/redefinir` → `200`, login com a
  **nova** senha funciona, com a antiga não
- celular sem cadastro → `otp/enviar` responde `200 { enviado:true }` e
  **não** enfileira mensagem (conta linhas em `mensagens_whatsapp`)
- cliente com senha mas `celular_verificado=false` → idem (silencioso)
- código expirado → `400 OTP_INVALIDO`
- 4ª chamada de `otp/enviar` no mesmo celular em 10 min → `429
  MUITAS_TENTATIVAS` (com `resetRateLimit()` no `beforeEach`)

### Regressão
`test/http/paginas.test.js`, `test/http/csp.test.js`,
`test/http/admin-paginas.test.js`, `test/http/cliente.test.js`,
`test/agenda/confirmar.test.js` (o refactor de `enfileirarMensagem` não pode
mudar o comportamento da confirmação).

---

## 16. Impacto em P1–P4

- **`src/agenda/agendar.js`** — `enfileirarConfirmacao` vira uma chamada a
  `enfileirarMensagem`; teste `test/agenda/confirmar.test.js` cobre a
  equivalência.
- **`src/db/seed.js`** — `TEMPLATES` cresce de 3 para 4; `test/services/
  templates-meta.test.js` itera o array, deve continuar passando.
- **`src/auth/rateLimit.js`** — só adiciona; `resetRateLimit()` ganha uma
  linha.
- **Migrações** — `005` é a próxima na sequência; `bootstrap.js` (P4) aplica
  sozinho no start.
- Nenhuma rota ou contrato existente muda de forma incompatível; `/cadastro`
  só **adiciona** um campo opcional e uma exigência condicional a quem já
  mandava `senha`.

---

## 17. Depois do P5 (fora do núcleo)

- Driver de SMS real plugado no worker `mensageiro` (Twilio Messages), a
  seco das chaves `TWILIO_*`.
- Lembrete 24 h / pós-atendimento automáticos (cron varrendo o dia seguinte).
- Badge "verificado" no admin; forçar verificação também no cadastro anônimo.
- Reset por e-mail como fallback para contas sem celular verificado.
