// src/agenda/agendar.js
import { withTransaction } from '../db/pool.js';
import { adicionarMinutos } from '../lib/tempo.js';
import { renderizarTemplate } from '../lib/template.js';
import { calcularComissao } from '../services/comissao.js';
import { verificarSlot } from './disponibilidade.js';

function execDe(client) {
  return (text, params) => client.query(text, params);
}

async function enfileirarConfirmacao(exec, agendamento) {
  const dados = await exec(
    `SELECT c.nome AS cliente_nome, c.celular, s.nome AS servico_nome,
            cf.nome_barbearia, cf.endereco
     FROM agendamentos a
     JOIN clientes c ON c.id = a.cliente_id
     JOIN servicos s ON s.id = a.servico_id
     CROSS JOIN configuracao cf
     WHERE a.id = $1 AND cf.id = 1`,
    [agendamento.id],
  );
  const d = dados.rows[0];
  const tpl = await exec(`SELECT corpo FROM templates_mensagem WHERE chave='confirmacao' AND ativo`);
  if (tpl.rowCount === 0) return;
  const texto = renderizarTemplate(tpl.rows[0].corpo, {
    nome_cliente: d.cliente_nome,
    nome_servico: d.servico_nome,
    data: agendamento.data_agendamento.toISOString().slice(0, 10),
    horario: String(agendamento.horario_inicio).slice(0, 5),
    endereco_barbearia: d.endereco ?? '',
    nome_barbearia: d.nome_barbearia,
  });
  await exec(
    `INSERT INTO mensagens_whatsapp (agendamento_id, template_chave, telefone_destino, mensagem_final, status_envio)
     VALUES ($1, 'confirmacao', $2, $3, 'pendente')`,
    [agendamento.id, d.celular, texto],
  );
}

export async function confirmarAgendamento({
  clienteId, servicoId, barbeiroId, data, horario,
  sessionId, observacoes = null, agora = new Date(),
}) {
  return withTransaction(async (c) => {
    const exec = execDe(c);

    const srv = await exec(
      `SELECT duracao_minutos, preco, comissao_percentual FROM servicos WHERE id=$1 AND ativo`,
      [servicoId],
    );
    if (srv.rowCount === 0) return { ok: false, erro: 'SERVICO_INVALIDO' };
    const { duracao_minutos, preco, comissao_percentual } = srv.rows[0];
    const horarioFim = adicionarMinutos(horario, duracao_minutos);

    const val = await verificarSlot(exec, {
      barbeiroId, data, horario, duracaoMinutos: duracao_minutos, agora,
    });
    if (!val.ok) return val;

    let ins;
    try {
      ins = await exec(
        `INSERT INTO agendamentos
           (cliente_id, servico_id, barbeiro_id, data_agendamento,
            horario_inicio, horario_fim, status, valor_total, comissao_valor, observacoes)
         VALUES ($1,$2,$3,$4,$5,$6,'pendente',$7,$8,$9)
         RETURNING *`,
        [clienteId, servicoId, barbeiroId, data, horario, horarioFim,
         preco, calcularComissao(preco, comissao_percentual), observacoes],
      );
    } catch (err) {
      if (err.code === '23505') return { ok: false, erro: 'HORARIO_INDISPONIVEL' };
      throw err;
    }

    await exec(
      `DELETE FROM horarios_lock WHERE barbeiro_id=$1 AND data=$2 AND horario=$3`,
      [barbeiroId, data, horario],
    );
    await exec(`UPDATE clientes SET ultimo_agendamento=$1 WHERE id=$2`, [data, clienteId]);
    await enfileirarConfirmacao(exec, ins.rows[0]);

    return { ok: true, agendamento: ins.rows[0] };
  });
}
