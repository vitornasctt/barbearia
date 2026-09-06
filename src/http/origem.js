import { config } from '../config.js';
import { ErroHttp } from './erros.js';

const SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS']);

function origensPermitidas() {
  const extras = config.ORIGENS_PERMITIDAS.split(',').map((s) => s.trim()).filter(Boolean);
  return new Set([config.APP_URL, ...extras]);
}

function origemDe(req) {
  if (req.headers.origin) return req.headers.origin;
  const ref = req.headers.referer;
  if (!ref) return null;
  try { return new URL(ref).origin; } catch { return null; }
}

export function exigirOrigemConfiavel(req, res, next) {
  if (SEGUROS.has(req.method)) return next();
  const origem = origemDe(req);
  if (!origem || !origensPermitidas().has(origem)) return next(new ErroHttp('SEM_PERMISSAO'));
  next();
}
