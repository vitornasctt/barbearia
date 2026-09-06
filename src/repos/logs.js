// src/repos/logs.js
import { query } from '../db/pool.js';

export async function registrar({ quem_tipo, quem_id = null, acao, ip = null, detalhe = null }) {
  await query(
    `INSERT INTO logs_acesso (quem_tipo, quem_id, acao, ip, detalhe)
     VALUES ($1,$2,$3,$4,$5)`,
    [quem_tipo, quem_id, acao, ip, detalhe]);
}
