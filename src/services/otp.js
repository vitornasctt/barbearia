// src/services/otp.js
import crypto from 'node:crypto';
import { hashSenha, verificarSenha } from '../auth/senha.js';
import * as otpRepo from '../repos/otp.js';

export const EXPIRA_MIN = 10;
export const MAX_TENTATIVAS = 5;

export function gerarCodigo() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

export async function emitir({ celular, proposito }) {
  await otpRepo.invalidarAbertos({ celular, proposito });
  const codigo = gerarCodigo();
  const codigoHash = await hashSenha(codigo);
  const expiraEm = new Date(Date.now() + EXPIRA_MIN * 60_000);
  await otpRepo.inserir({ celular, proposito, codigoHash, expiraEm });
  return { codigo };
}

export async function verificar({ celular, proposito, codigo }) {
  const falha = (motivo) => ({ ok: false, erro: 'OTP_INVALIDO', motivo });
  const row = await otpRepo.abertoMaisRecente({ celular, proposito });
  if (!row) return falha('inexistente');
  if (new Date(row.expira_em).getTime() < Date.now()) return falha('expirado');
  // Pré-checagem barata (early-out); a garantia real vem do RETURNING abaixo.
  if (row.tentativas >= MAX_TENTATIVAS) return falha('tentativas_esgotadas');
  // incrementarTentativa faz UPDATE ... RETURNING: trava a linha e devolve contagens
  // únicas e monótonas. Re-checar aqui fecha a janela de concorrência (TOCTOU)
  // antes do bcrypt/marcarVerificado — um palpite errado ainda conta.
  const t = await otpRepo.incrementarTentativa(row.id);
  if (t > MAX_TENTATIVAS) return falha('tentativas_esgotadas');
  if (!(await verificarSenha(String(codigo), row.codigo_hash))) return falha('codigo_errado');
  await otpRepo.marcarVerificado(row.id);
  return { ok: true };
}
