// src/services/mensagens.js
import { query } from '../db/pool.js';
import { renderizarTemplate } from '../lib/template.js';

export async function enfileirarMensagem(
  { templateChave, telefone, vars = {}, agendamentoId = null },
  exec = query,
) {
  const tpl = await exec(
    `SELECT corpo FROM templates_mensagem WHERE chave=$1 AND ativo`,
    [templateChave],
  );
  if (tpl.rowCount === 0) return { enfileirada: false };
  const texto = renderizarTemplate(tpl.rows[0].corpo, vars);
  await exec(
    `INSERT INTO mensagens_whatsapp (agendamento_id, template_chave, telefone_destino, mensagem_final, status_envio)
     VALUES ($1, $2, $3, $4, 'pendente')`,
    [agendamentoId, templateChave, telefone, texto],
  );
  return { enfileirada: true };
}
