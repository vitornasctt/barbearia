// src/auth/rateLimit.js
import rateLimit, { MemoryStore } from 'express-rate-limit';
import { ErroHttp } from '../http/erros.js';
import { normalizarCelular } from '../lib/celular.js';

// NOTA: express-rate-limit 7.5.1 não exporta o helper `ipKeyGenerator`
// (só `MemoryStore` e `rateLimit`). Sem ele, usamos `req.ip` diretamente na
// chave — o warning de IPv6 do lib fica, mas não há normalização de subnet.
const bloqueio = (req, res, next) => next(new ErroHttp('MUITAS_TENTATIVAS'));

// Stores exportados para os testes zerarem entre casos (rate-limit é global do módulo).
export const storeLogin = new MemoryStore();
export const storeLoginIp = new MemoryStore();
export const storeMensagens = new MemoryStore();
export const storeOtpCelular = new MemoryStore();
export const storeOtpIp = new MemoryStore();
// Referência de conveniência que reseta ambos os stores de OTP
export const storeOtp = {
  resetAll: () => { storeOtpCelular.resetAll?.(); storeOtpIp.resetAll?.(); },
};

export function resetRateLimit() {
  storeLogin.resetAll?.();
  storeLoginIp.resetAll?.();
  storeMensagens.resetAll?.();
  storeOtp.resetAll?.();
}

export const limiteLogin = rateLimit({
  windowMs: 15 * 60_000,
  limit: 5,
  store: storeLogin,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `${req.ip}:${req.body?.email ?? req.body?.celular ?? ''}`,
  handler: bloqueio,
});

// Segundo limitador, mais frouxo, só por IP — barra força bruta que varia a conta.
export const limiteLoginIp = rateLimit({
  windowMs: 15 * 60_000,
  limit: 30,
  store: storeLoginIp,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
  handler: bloqueio,
});

export const limiteMensagens = rateLimit({
  windowMs: 5 * 60_000,
  limit: 30,
  store: storeMensagens,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
  handler: bloqueio,
});

// OTP: por (IP + celular) — trava pedir código repetidamente para o mesmo número
export const limiteOtpCelular = rateLimit({
  windowMs: 10 * 60_000,
  limit: 3,
  store: storeOtpCelular,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // Normaliza o celular antes de compor a chave: sem isso cada formatação
  // (com/sem +55, com máscara) vira um bucket próprio e o cap de 3/10min
  // passa a valer por variante de formato, não por número.
  keyGenerator: (req) => {
    let c = String(req.body?.celular ?? '');
    try { c = normalizarCelular(c); } catch { /* mantém o valor bruto */ }
    return `${req.ip}:${c}`;
  },
  handler: bloqueio,
});

// OTP: só por IP — trava varredura de números
export const limiteOtpIp = rateLimit({
  windowMs: 10 * 60_000,
  limit: 20,
  store: storeOtpIp,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
  handler: bloqueio,
});
