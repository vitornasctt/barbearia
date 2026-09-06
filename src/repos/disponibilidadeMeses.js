// src/repos/disponibilidadeMeses.js
import { query } from '../db/pool.js';

export async function doAno(ano, barbeiroId = null) {
  const { rows } = await query(
    `SELECT DISTINCT ON (mes) mes, status, limite_por_dia
     FROM agenda_disponibilidade
     WHERE ano=$1 AND (barbeiro_id IS NULL OR barbeiro_id=$2)
     ORDER BY mes, barbeiro_id NULLS LAST`,
    [ano, barbeiroId]);
  const porMes = new Map(rows.map((r) => [r.mes, r]));
  return Array.from({ length: 12 }, (_, i) => porMes.get(i + 1) ?? { mes: i + 1, status: 'fechado', limite_por_dia: null });
}

export async function definir({ ano, mes, status, limite_por_dia = null, barbeiro_id = null }) {
  // UNIQUE (ano, mes, barbeiro_id) trata NULL como distinto: ON CONFLICT não dispara
  // quando barbeiro_id IS NULL. Upsert NULL-safe via IS NOT DISTINCT FROM.
  const r = await query(
    `WITH upd AS (
       UPDATE agenda_disponibilidade
          SET status=$4, limite_por_dia=$5
        WHERE ano=$1 AND mes=$2 AND barbeiro_id IS NOT DISTINCT FROM $3::int
       RETURNING *
     ), ins AS (
       INSERT INTO agenda_disponibilidade (ano, mes, barbeiro_id, status, limite_por_dia)
       SELECT $1,$2,$3::int,$4,$5
        WHERE NOT EXISTS (SELECT 1 FROM upd)
       RETURNING *
     )
     SELECT * FROM upd UNION ALL SELECT * FROM ins`,
    [ano, mes, barbeiro_id, status, limite_por_dia]);
  return r.rows[0];
}
