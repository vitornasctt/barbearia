// src/repos/agendamentos.js
import { query } from '../db/pool.js';
import { hoje, inicioDoMes, fimDoMes } from '../lib/datas.js';

const SELECT_ITEM = `
  SELECT a.id, a.data_agendamento, to_char(a.horario_inicio,'HH24:MI') AS horario_inicio,
         to_char(a.horario_fim,'HH24:MI') AS horario_fim, a.status, a.valor_total,
         a.comissao_valor, a.observacoes,
         c.id AS c_id, c.nome AS c_nome, c.celular AS c_celular,
         s.id AS s_id, s.nome AS s_nome, s.preco AS s_preco,
         u.id AS u_id, u.nome AS u_nome
  FROM agendamentos a
  JOIN clientes c ON c.id = a.cliente_id
  JOIN servicos s ON s.id = a.servico_id
  JOIN usuarios u ON u.id = a.barbeiro_id`;

function moldar(r) {
  return {
    id: r.id, data_agendamento: r.data_agendamento,
    horario_inicio: r.horario_inicio, horario_fim: r.horario_fim,
    status: r.status, valor_total: r.valor_total, comissao_valor: r.comissao_valor,
    observacoes: r.observacoes,
    cliente: { id: r.c_id, nome: r.c_nome, celular: r.c_celular },
    servico: { id: r.s_id, nome: r.s_nome, preco: r.s_preco },
    barbeiro: { id: r.u_id, nome: r.u_nome },
  };
}

export async function listar({ de, ate, status, cliente, page = 1, tamanho = 20 } = {}) {
  const cond = [];
  const params = [];
  if (de) { params.push(de); cond.push(`a.data_agendamento >= $${params.length}`); }
  if (ate) { params.push(ate); cond.push(`a.data_agendamento <= $${params.length}`); }
  if (status) { params.push(status); cond.push(`a.status = $${params.length}`); }
  if (cliente) {
    params.push(`%${cliente}%`);
    cond.push(`(c.nome ILIKE $${params.length} OR c.celular LIKE $${params.length})`);
  }
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  const tot = await query(
    `SELECT count(*)::int AS n FROM agendamentos a JOIN clientes c ON c.id=a.cliente_id ${where}`, params);
  params.push(tamanho, (page - 1) * tamanho);
  const r = await query(
    `${SELECT_ITEM} ${where} ORDER BY a.data_agendamento DESC, a.horario_inicio DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  return { itens: r.rows.map(moldar), total: tot.rows[0].n, page };
}

export async function doCliente(clienteId, quando) {
  const futuros = quando === 'futuros';
  const r = await query(
    `${SELECT_ITEM}
     WHERE a.cliente_id = $1 AND (
       ($2 AND a.data_agendamento >= $3 AND a.status IN ('pendente','confirmado'))
       OR (NOT $2 AND (a.data_agendamento < $3 OR a.status IN ('concluido','cancelado')))
     )
     ORDER BY a.data_agendamento ${futuros ? 'ASC' : 'DESC'}, a.horario_inicio`,
    [clienteId, futuros, hoje()]);
  return r.rows.map(moldar);
}

export async function porId(id) {
  const r = await query(`${SELECT_ITEM} WHERE a.id = $1`, [id]);
  return r.rows[0] ? moldar(r.rows[0]) : null;
}

export async function dashboard() {
  const h = hoje();
  const [ano, mes] = h.split('-').map(Number);
  const ini = inicioDoMes(ano, mes);
  const fim = fimDoMes(ano, mes);
  const hojeRows = await query(
    `${SELECT_ITEM} WHERE a.data_agendamento = $1 AND a.status IN ('pendente','confirmado')
     ORDER BY a.horario_inicio`, [h]);
  const cont = await query(
    `SELECT
       (SELECT count(*)::int FROM agendamentos WHERE data_agendamento=$1 AND status IN ('pendente','confirmado')) AS cortes_hoje,
       (SELECT count(*)::int FROM agendamentos WHERE data_agendamento BETWEEN $2 AND $3 AND status <> 'cancelado') AS agendamentos_mes,
       (SELECT COALESCE(SUM(valor_total),0) FROM agendamentos WHERE data_agendamento BETWEEN $2 AND $3 AND status='concluido') AS faturamento_mes,
       (SELECT COALESCE(SUM(comissao_valor),0) FROM agendamentos WHERE data_agendamento BETWEEN $2 AND $3 AND status='concluido') AS comissao_mes`,
    [h, ini, fim]);
  return { hoje: hojeRows.rows.map(moldar), contadores: cont.rows[0] };
}

async function mudarStatus(id, novo, deOrigem) {
  const r = await query(
    `UPDATE agendamentos SET status=$2, updated_at=now()
     WHERE id=$1 AND status IN (${deOrigem}) RETURNING id`, [id, novo]);
  return r.rowCount ? porId(id) : null;
}
export const concluir = (id) => mudarStatus(id, 'concluido', `'pendente','confirmado'`);
export const confirmarStatus = (id) => mudarStatus(id, 'confirmado', `'pendente'`);
