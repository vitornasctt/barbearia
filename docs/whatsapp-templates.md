# Modelos de Mensagens WhatsApp (Formato Meta)

Este documento descreve os modelos de mensagens WhatsApp registrados na WhatsApp Cloud API (Meta), com os placeholders posicionais conforme exigido pelo Gerenciador de Modelos.

---

## 1. Confirmação de Agendamento

**Nome:** `confirmacao`  
**Categoria:** UTILITY  
**Idioma:** pt_BR

### Corpo (formato Meta, placeholders posicionais)

```
Olá, {{1}}!
Seu agendamento para {{2}} está confirmado!
📅 Data: {{3}}
⏰ Horário: {{4}}
📍 Local: {{5}}
Para confirmar, responda SIM. Para cancelar ou remarcar, responda NÃO.
```

### Mapa de variáveis

| Placeholder | Variável | Tipo |
|-------------|----------|------|
| {{1}} | nome_cliente | string |
| {{2}} | nome_servico | string |
| {{3}} | data | string |
| {{4}} | horario | string |
| {{5}} | endereco_barbearia | string |

### Exemplo (para o formulário de submissão da Meta)

```
Olá, Ana!
Seu agendamento para Corte está confirmado!
📅 Data: 10/09/2026
⏰ Horário: 14:00
📍 Local: Rua Exemplo, 123 - São Paulo
Para confirmar, responda SIM. Para cancelar ou remarcar, responda NÃO.
```

---

## 2. Lembrete 24h

**Nome:** `lembrete_24h`  
**Categoria:** UTILITY  
**Idioma:** pt_BR

### Corpo (formato Meta, placeholders posicionais)

```
Olá, {{1}}!
Lembrete: seu corte está agendado para amanhã às {{2}}.
Estamos aguardando você! 💈
```

### Mapa de variáveis

| Placeholder | Variável | Tipo |
|-------------|----------|------|
| {{1}} | nome_cliente | string |
| {{2}} | horario | string |

### Exemplo (para o formulário de submissão da Meta)

```
Olá, Carlos!
Lembrete: seu corte está agendado para amanhã às 10:30.
Estamos aguardando você! 💈
```

---

## 3. Pós-Atendimento

**Nome:** `pos_atendimento`  
**Categoria:** UTILITY  
**Idioma:** pt_BR

### Corpo (formato Meta, placeholders posicionais)

```
Olá, {{1}}!
Obrigado por visitar nossa barbearia!
Esperamos vê-lo em breve. 💈
Indique para os amigos e ganhe desconto!
```

### Mapa de variáveis

| Placeholder | Variável | Tipo |
|-------------|----------|------|
| {{1}} | nome_cliente | string |

### Exemplo (para o formulário de submissão da Meta)

```
Olá, João!
Obrigado por visitar nossa barbearia!
Esperamos vê-lo em breve. 💈
Indique para os amigos e ganhe desconto!
```

---

## 4. Código de Verificação

**Nome:** `codigo_verificacao`  
**Categoria:** AUTHENTICATION  
**Idioma:** pt_BR

### Corpo (formato Meta, placeholders posicionais)

```
Seu código {{1}} para {{2}}.
Vale por 10 minutos. Não compartilhe com ninguém.
```

### Mapa de variáveis

| Placeholder | Variável | Tipo |
|-------------|----------|------|
| {{1}} | codigo | string |
| {{2}} | nome_barbearia | string |

### Exemplo (para o formulário de submissão da Meta)

```
Seu código 123456 para Minha Barbearia.
Vale por 10 minutos. Não compartilhe com ninguém.
```

---

## Como ativar o envio real

Após criar os modelos acima, siga os passos abaixo para habilitar o envio de mensagens com estes templates:

1. **Conta Meta Business verificada e número registrado:**
   - Crie ou acesse sua conta Meta Business em https://business.facebook.com
   - Registre um número de telefone dedicado na WhatsApp Cloud API (https://developers.facebook.com/docs/whatsapp/cloud-api)

2. **Preenchimento das variáveis de ambiente:**
   - `WHATSAPP_PHONE_NUMBER_ID`: o ID do seu número de telefone WhatsApp (fornecido pela Meta)
   - `WHATSAPP_TOKEN`: token de sistema permanente gerado no painel Meta (com permissão `whatsapp_business_messaging`)
   - `WHATSAPP_VERIFY_TOKEN`: um token de segurança inventado por você (usado para validar webhooks)
   - `WHATSAPP_APP_SECRET`: a chave secreta do seu aplicativo Meta

3. **Registro do webhook:**
   - Acesse o Painel Meta → Configurações do Aplicativo → Webhooks
   - Cadastre `https://<APP_URL>/webhooks/whatsapp` como URL de callback
   - Use `WHATSAPP_VERIFY_TOKEN` como token de validação
   - O endpoint GET já responde automaticamente com `hub.challenge` para validação

4. **Submissão dos modelos:**
   - No Painel Meta → Gerenciador de Modelos → WhatsApp
   - Submeta os modelos descritos acima (confirmacao, lembrete_24h, pos_atendimento, codigo_verificacao)
   - Aguarde aprovação (templates Utility costumam ser aprovados rapidamente; AUTHENTICATION também é rápido)

5. **Próximo passo de integração:**
   - **Estado atual:** `src/services/whatsapp.js` envia mensagens com `type: 'text'` (mensagens livres), que funcionam dentro da janela de 24h após o cliente responder
   - **Próxima etapa:** Para enviar lembretes fora da janela de 24h ou para campanhas proativas, será necessário trocar para *template messages* (`type: 'template'`) no envio, referenciando os nomes dos templates aprovados acima
