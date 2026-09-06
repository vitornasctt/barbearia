// src/services/whatsapp.js
import { config } from '../config.js';

function temCredencial() {
  return Boolean(config.WHATSAPP_TOKEN && config.WHATSAPP_PHONE_NUMBER_ID);
}

export async function enviar(row) {
  if (!temCredencial()) return { status: 'simulado' };
  try {
    const resp = await fetch(
      `https://graph.facebook.com/v20.0/${config.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.WHATSAPP_TOKEN}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: row.telefone_destino,
          type: 'text',
          text: { body: row.mensagem_final },
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!resp.ok) {
      const txt = (await resp.text()).slice(0, 300);
      return { status: 'falha', erro: `HTTP ${resp.status}: ${txt}` };
    }
    const json = await resp.json();
    return { status: 'enviado', wamid: json.messages?.[0]?.id };
  } catch (e) {
    return { status: 'falha', erro: String(e.message).slice(0, 300) };
  }
}
