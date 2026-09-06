// src/repos/clientes.js
import { query } from '../db/pool.js';

export async function porCelular(celular) {
  const r = await query(
    `SELECT id, nome, celular, email, senha_hash, celular_verificado
     FROM clientes WHERE celular=$1`, [celular]);
  return r.rows[0] ?? null;
}

export async function criar({ nome, celular, email = null, senha_hash = null }) {
  const r = await query(
    `INSERT INTO clientes (nome, celular, email, senha_hash)
     VALUES ($1,$2,$3,$4) RETURNING id, nome`,
    [nome, celular, email, senha_hash]);
  return r.rows[0];
}
