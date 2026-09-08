// src/repos/clientes.js
import { query } from '../db/pool.js';

export async function porCelular(celular) {
  const r = await query(
    `SELECT id, nome, celular, email, senha_hash, celular_verificado
     FROM clientes WHERE celular=$1`, [celular]);
  return r.rows[0] ?? null;
}

export async function porId(id) {
  const r = await query(
    `SELECT id, nome, celular, email, senha_hash, celular_verificado
     FROM clientes WHERE id=$1`, [id]);
  return r.rows[0] ?? null;
}

export async function criar({ nome, celular, email = null, senha_hash = null, celular_verificado = false }) {
  const r = await query(
    `INSERT INTO clientes (nome, celular, email, senha_hash, celular_verificado)
     VALUES ($1,$2,$3,$4,$5) RETURNING id, nome`,
    [nome, celular, email, senha_hash, celular_verificado]);
  return r.rows[0];
}

export function definirSenha(id, senha_hash) {
  return query(`UPDATE clientes SET senha_hash=$2 WHERE id=$1`, [id, senha_hash]).then(() => {});
}

export function marcarCelularVerificado(id) {
  return query(`UPDATE clientes SET celular_verificado=TRUE WHERE id=$1`, [id]).then(() => {});
}
