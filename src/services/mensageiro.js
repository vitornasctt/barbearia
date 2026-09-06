// src/services/mensageiro.js
import { query, withTransaction } from '../db/pool.js';
import { enviar } from './whatsapp.js';

export async function processarPendentes({ limite = 20 } = {}) {
  // Fase 1: reivindica as linhas numa transação curta (ponto de serialização).
  const { rows } = await withTransaction((c) => c.query(
    `UPDATE mensagens_whatsapp SET status_envio='enviando'
     WHERE id IN (
       SELECT id FROM mensagens_whatsapp
       WHERE (status_envio='pendente'
              OR (status_envio='enviando' AND enviado_em IS NULL
                  AND created_at < now() - interval '5 minutes'))
       ORDER BY created_at
       LIMIT $1 FOR UPDATE SKIP LOCKED
     )
     RETURNING id, telefone_destino, mensagem_final`,
    [limite],
  ));

  // Fase 2: envia (I/O de rede) e atualiza cada linha FORA de qualquer transação.
  let processadas = 0;
  let falhas = 0;
  for (const row of rows) {
    const r = await enviar(row);
    await query(
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
}
