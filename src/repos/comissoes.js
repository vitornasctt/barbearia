// src/repos/comissoes.js
import { query } from '../db/pool.js';
import { inicioDoMes, fimDoMes } from '../lib/datas.js';

export async function relatorio({ ano, mes, barbeiroId = null }) {
  const r = await query(
    `SELECT s.nome AS servico,
            count(*)::int AS qtd,
            COALESCE(SUM(a.valor_total),0) AS faturamento,
            s.comissao_percentual AS percentual,
            COALESCE(SUM(a.comissao_valor),0) AS comissao
     FROM agendamentos a JOIN servicos s ON s.id=a.servico_id
     WHERE a.status='concluido'
       AND a.data_agendamento BETWEEN $1 AND $2
       AND ($3::int IS NULL OR a.barbeiro_id=$3)
     GROUP BY s.nome, s.comissao_percentual
     ORDER BY comissao DESC`,
    [inicioDoMes(ano, mes), fimDoMes(ano, mes), barbeiroId]);
  const total = r.rows.reduce((acc, l) => ({
    qtd: acc.qtd + l.qtd,
    faturamento: acc.faturamento + Number(l.faturamento),
    comissao: acc.comissao + Number(l.comissao),
  }), { qtd: 0, faturamento: 0, comissao: 0 });
  return { linhas: r.rows, total };
}
