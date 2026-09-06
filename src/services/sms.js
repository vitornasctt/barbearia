// src/services/sms.js
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { hashSenha, verificarSenha } from '../auth/senha.js';

function driverSimulado() {
  return !config.TWILIO_ACCOUNT_SID;
}

function gerarCodigo() {
  return driverSimulado() ? '000000' : String(Math.floor(100000 + Math.random() * 900000));
}

export async function enviarOtp(celular) {
  const codigo = gerarCodigo();
  const hash = await hashSenha(codigo);
  await query(
    `INSERT INTO otp_codigos (celular, codigo_hash, expira_em)
     VALUES ($1, $2, now() + interval '10 minutes')`,
    [celular, hash],
  );
  // driver real (Twilio Verify) fica p/ pós-P4; no P2 o código simulado é 000000.
  return { enviado: true };
}

export async function verificarOtp(celular, codigo) {
  const { rows } = await query(
    `SELECT id, codigo_hash, tentativas FROM otp_codigos
     WHERE celular=$1 AND verificado=false AND expira_em > now()
     ORDER BY id DESC LIMIT 1`,
    [celular],
  );
  const row = rows[0];
  if (!row) return false;
  await query(`UPDATE otp_codigos SET tentativas = tentativas + 1 WHERE id=$1`, [row.id]);
  if (row.tentativas + 1 > 5) return false;
  const ok = await verificarSenha(String(codigo), row.codigo_hash);
  if (!ok) return false;
  await query(`UPDATE otp_codigos SET verificado=true WHERE id=$1`, [row.id]);
  await query(`UPDATE clientes SET celular_verificado=true WHERE celular=$1`, [celular]);
  return true;
}
