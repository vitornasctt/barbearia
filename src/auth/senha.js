// src/auth/senha.js
import bcrypt from 'bcrypt';

const CUSTO = 12;

export function hashSenha(texto) {
  return bcrypt.hash(texto, CUSTO);
}

export function verificarSenha(texto, hash) {
  return bcrypt.compare(texto, hash);
}
