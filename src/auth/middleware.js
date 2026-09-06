import { ErroHttp } from '../http/erros.js';

export function anexarSessaoAnonima(req, res, next) {
  req.sessionId = req.sessionID;
  next();
}

export function requireCliente(req, res, next) {
  if (req.session?.clienteId) return next();
  next(new ErroHttp('NAO_AUTENTICADO'));
}

export function requireEquipe(req, res, next) {
  const s = req.session;
  const ok = s?.usuarioId && (s.role === 'admin' || s.role === 'barbeiro');
  if (!ok) return next(new ErroHttp('NAO_AUTENTICADO'));
  if (!s.equipeExpiraEm || Date.now() > s.equipeExpiraEm) {
    s.destroy?.(() => {});
    return next(new ErroHttp('NAO_AUTENTICADO'));
  }
  next();
}

export function requireAdmin(req, res, next) {
  requireEquipe(req, res, (err) => {
    if (err) return next(err);
    if (req.session.role !== 'admin') return next(new ErroHttp('SEM_PERMISSAO'));
    next();
  });
}
