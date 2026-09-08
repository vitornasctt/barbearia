// src/repos/mensagens.js
import { query } from '../db/pool.js';

export async function listar({ agendamento_id, status, page = 1, tamanho = 20 } = {}) {
  const cond = [];
  const params = [];
  if (agendamento_id) { params.push(agendamento_id); cond.push(`agendamento_id=$${params.length}`); }
  if (status) { params.push(status); cond.push(`status_envio=$${params.length}`); }
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  const tot = await query(`SELECT count(*)::int AS n FROM mensagens_whatsapp ${where}`, params);
  params.push(tamanho, (page - 1) * tamanho);
  const r = await query(
    `SELECT id, agendamento_id, template_chave, telefone_destino,
            CASE WHEN template_chave = 'codigo_verificacao' THEN '[código omitido]' ELSE mensagem_final END AS mensagem_final,
            status_envio, erro, enviado_em, created_at
     FROM mensagens_whatsapp ${where}
     ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  return { itens: r.rows, total: tot.rows[0].n, page };
}

export async function enfileirar({ agendamento_id, template_chave, telefone_destino, mensagem_final }) {
  const r = await query(
    `INSERT INTO mensagens_whatsapp (agendamento_id, template_chave, telefone_destino, mensagem_final, status_envio)
     VALUES ($1,$2,$3,$4,'pendente') RETURNING *`,
    [agendamento_id, template_chave, telefone_destino, mensagem_final]);
  return r.rows[0];
}
