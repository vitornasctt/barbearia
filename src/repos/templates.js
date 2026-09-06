// src/repos/templates.js
import { query } from '../db/pool.js';

export async function todos() {
  const r = await query(`SELECT chave, titulo, corpo, ativo FROM templates_mensagem ORDER BY chave`);
  return r.rows;
}

export async function porChave(chave) {
  const r = await query(`SELECT chave, titulo, corpo, ativo FROM templates_mensagem WHERE chave=$1`, [chave]);
  return r.rows[0] ?? null;
}

export async function atualizar(chave, { titulo, corpo, ativo }) {
  const r = await query(
    `UPDATE templates_mensagem SET titulo=$2, corpo=$3, ativo=$4 WHERE chave=$1
     RETURNING chave, titulo, corpo, ativo`,
    [chave, titulo, corpo, ativo]);
  return r.rows[0] ?? null;
}
