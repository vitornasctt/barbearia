// src/auth/rateLimit.js
import rateLimit, { MemoryStore } from 'express-rate-limit';
import { ErroHttp } from '../http/erros.js';

const bloqueio = (req, res, next) => next(new ErroHttp('MUITAS_TENTATIVAS'));

// Stores exportados para os testes zerarem entre casos (rate-limit é global do módulo).
export const storeLogin = new MemoryStore();
export const storeMensagens = new MemoryStore();

export function resetRateLimit() {
  storeLogin.resetAll?.();
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

export const limiteMensagens = rateLimit({
  windowMs: 5 * 60_000,
  limit: 30,
  store: storeMensagens,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
  handler: bloqueio,
});
