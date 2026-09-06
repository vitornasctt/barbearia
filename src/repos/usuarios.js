// src/repos/usuarios.js
import { query } from '../db/pool.js';

export async function porEmail(email) {
  const r = await query(
    `SELECT id, nome, email, senha_hash, role, ativo FROM usuarios WHERE email=$1`, [email]);
  return r.rows[0] ?? null;
}
