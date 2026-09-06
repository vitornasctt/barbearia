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

// Shared equipe validation predicate
export function equipeValida(session) {
  return !!(session?.usuarioId && (session.role === 'admin' || session.role === 'barbeiro')
    && session.equipeExpiraEm && Date.now() <= session.equipeExpiraEm);
}

// Page-guard middlewares (redirect on failure, not JSON error)
export function paginaEquipe(req, res, next) {
  if (equipeValida(req.session)) return next();
  res.redirect(302, '/admin/login?next=' + encodeURIComponent(req.originalUrl));
}

export function paginaCliente(req, res, next) {
  if (req.session?.clienteId) return next();
  res.redirect(302, '/minha-conta');
}
