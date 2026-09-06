// src/auth/rateLimit.js
import rateLimit, { MemoryStore } from 'express-rate-limit';
import { ErroHttp } from '../http/erros.js';

// NOTA: express-rate-limit 7.5.1 não exporta o helper `ipKeyGenerator`
// (só `MemoryStore` e `rateLimit`). Sem ele, usamos `req.ip` diretamente na
// chave — o warning de IPv6 do lib fica, mas não há normalização de subnet.
const bloqueio = (req, res, next) => next(new ErroHttp('MUITAS_TENTATIVAS'));

// Stores exportados para os testes zerarem entre casos (rate-limit é global do módulo).
export const storeLogin = new MemoryStore();
export const storeLoginIp = new MemoryStore();
export const storeMensagens = new MemoryStore();

export function resetRateLimit() {
  storeLogin.resetAll?.();
  storeLoginIp.resetAll?.();
  storeMensagens.resetAll?.();
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
