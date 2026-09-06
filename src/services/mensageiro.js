// src/services/mensageiro.js
import { withTransaction } from '../db/pool.js';
import { enviar } from './whatsapp.js';

export async function processarPendentes({ limite = 20 } = {}) {
  return withTransaction(async (c) => {
    const { rows } = await c.query(
      `SELECT id, telefone_destino, mensagem_final
       FROM mensagens_whatsapp
       WHERE status_envio='pendente'
       ORDER BY created_at
       LIMIT $1 FOR UPDATE SKIP LOCKED`,
      [limite],
    );
    let processadas = 0;
    let falhas = 0;
    for (const row of rows) {
      const r = await enviar(row);
      await c.query(
        `UPDATE mensagens_whatsapp
         SET status_envio=$2::text,
             enviado_em = CASE WHEN $2::text IN ('enviado','simulado','entregue') THEN now() ELSE enviado_em END,
             erro=$3
         WHERE id=$1`,
        [row.id, r.status, r.erro ?? null],
      );
      if (r.status === 'falha') falhas++; else processadas++;
    }
    return { processadas, falhas };
  });
}
