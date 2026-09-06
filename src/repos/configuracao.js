// src/repos/configuracao.js
import { query } from '../db/pool.js';

const COLS = ['nome_barbearia', 'endereco', 'latitude', 'longitude', 'telefone_whatsapp',
  'intervalo_minutos', 'antecedencia_min_horas', 'limite_dias_futuros', 'barbeiro_padrao_id'];

export async function obter() {
  const cfg = await query(`SELECT * FROM configuracao WHERE id=1`);
  const exp = await query(
    `SELECT dia_semana, aberto, to_char(abre,'HH24:MI:SS') AS abre, to_char(fecha,'HH24:MI:SS') AS fecha
     FROM horario_funcionamento ORDER BY dia_semana`);
  return { ...cfg.rows[0], expediente: exp.rows };
}

export async function atualizar(campos, expediente) {
  const entradas = Object.entries(campos ?? {}).filter(([k]) => COLS.includes(k));
  if (entradas.length > 0) {
    const set = entradas.map(([k], i) => `${k}=$${i + 1}`).join(', ');
    await query(`UPDATE configuracao SET ${set}, updated_at=now() WHERE id=1`,
      entradas.map(([, v]) => v));
  }
  if (Array.isArray(expediente)) {
    for (const e of expediente) {
      await query(
        `UPDATE horario_funcionamento SET aberto=$2, abre=$3, fecha=$4 WHERE dia_semana=$1`,
        [e.dia_semana, e.aberto, e.abre, e.fecha]);
    }
  }
  return obter();
}
