// src/repos/servicos.js
import { query } from '../db/pool.js';

const COLS = ['nome', 'duracao_minutos', 'preco', 'comissao_percentual', 'ativo'];

export async function ativos() {
  const r = await query(
    `SELECT id, nome, duracao_minutos, preco FROM servicos WHERE ativo ORDER BY nome`);
  return r.rows;
}

export async function todos() {
  const r = await query(
    `SELECT id, nome, duracao_minutos, preco, comissao_percentual, ativo FROM servicos ORDER BY nome`);
  return r.rows;
}

export async function porId(id) {
  const r = await query(`SELECT * FROM servicos WHERE id=$1`, [id]);
  return r.rows[0] ?? null;
}

export async function criar({ nome, duracao_minutos, preco, comissao_percentual }) {
  const r = await query(
    `INSERT INTO servicos (nome, duracao_minutos, preco, comissao_percentual)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [nome, duracao_minutos, preco, comissao_percentual]);
  return r.rows[0];
}

export async function atualizar(id, campos) {
  const entradas = Object.entries(campos).filter(([k]) => COLS.includes(k));
  if (entradas.length === 0) return porId(id);
  const set = entradas.map(([k], i) => `${k}=$${i + 2}`).join(', ');
  const r = await query(
    `UPDATE servicos SET ${set} WHERE id=$1 RETURNING *`,
    [id, ...entradas.map(([, v]) => v)]);
  return r.rows[0] ?? null;
}

export async function remover(id) {
  const usado = await query(`SELECT 1 FROM agendamentos WHERE servico_id=$1 LIMIT 1`, [id]);
  if (usado.rowCount > 0) {
    await query(`UPDATE servicos SET ativo=false WHERE id=$1`, [id]);
    return 'soft';
  }
  await query(`DELETE FROM servicos WHERE id=$1`, [id]);
  return 'hard';
}
