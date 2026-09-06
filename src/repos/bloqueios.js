// src/repos/bloqueios.js
import { query } from '../db/pool.js';

export async function entre(de, ate, barbeiroId = null) {
  const r = await query(
    `SELECT id, barbeiro_id, to_char(data,'YYYY-MM-DD') AS data,
            to_char(hora_inicio,'HH24:MI') AS hora_inicio,
            to_char(hora_fim,'HH24:MI') AS hora_fim, motivo
     FROM bloqueios_agenda
     WHERE data BETWEEN $1 AND $2 AND (barbeiro_id IS NULL OR barbeiro_id=$3)
     ORDER BY data`,
    [de, ate, barbeiroId]);
  return r.rows;
}

export async function criar({ data, hora_inicio = null, hora_fim = null, motivo = null, barbeiro_id = null, criado_por = null }) {
  const r = await query(
    `INSERT INTO bloqueios_agenda (barbeiro_id, data, hora_inicio, hora_fim, motivo, criado_por)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [barbeiro_id, data, hora_inicio, hora_fim, motivo, criado_por]);
  return r.rows[0];
}

export async function remover(id) {
  const r = await query(`DELETE FROM bloqueios_agenda WHERE id=$1`, [id]);
  return r.rowCount > 0;
}
