// src/repos/otp.js
import { query } from '../db/pool.js';

export function inserir({ celular, proposito, codigoHash, expiraEm }) {
  return query(
    `INSERT INTO otp_codigos (celular, proposito, codigo_hash, expira_em)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    [celular, proposito, codigoHash, expiraEm],
  ).then((r) => r.rows[0]);
}

export function abertoMaisRecente({ celular, proposito }) {
  return query(
    `SELECT id, codigo_hash, expira_em, tentativas, verificado
     FROM otp_codigos
     WHERE celular=$1 AND proposito=$2 AND verificado=FALSE
     ORDER BY created_at DESC LIMIT 1`,
    [celular, proposito],
  ).then((r) => r.rows[0]);
}

export function incrementarTentativa(id) {
  return query(
    `UPDATE otp_codigos SET tentativas = tentativas + 1 WHERE id=$1 RETURNING tentativas`,
    [id],
  ).then((r) => r.rows[0].tentativas);
}

export function marcarVerificado(id) {
  return query(`UPDATE otp_codigos SET verificado=TRUE WHERE id=$1`, [id]).then(() => {});
}

export function invalidarAbertos({ celular, proposito }) {
  return query(
    `UPDATE otp_codigos SET verificado=TRUE
     WHERE celular=$1 AND proposito=$2 AND verificado=FALSE`,
    [celular, proposito],
  ).then(() => {});
}

export function limparAntigos({ dias = 1 } = {}) {
  return query(
    `DELETE FROM otp_codigos WHERE created_at < now() - ($1 || ' days')::interval`,
    [String(dias)],
  ).then((r) => r.rowCount);
}
