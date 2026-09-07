import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ejs from 'ejs';
import { config } from '../config.js';

const VIEWS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'views');

export function gerarNonce() {
  return randomBytes(16).toString('base64');
}

export function renderPagina(res, view, dados = {}) {
  const ctx = { ...res.locals, ...dados };
  ejs.renderFile(path.join(VIEWS, `${view}.ejs`), ctx, {}, (err, corpo) => {
    if (err) return res.req.next(err);
    ejs.renderFile(path.join(VIEWS, 'layout.ejs'), { ...ctx, corpo }, {}, (err2, html) => {
      if (err2) return res.req.next(err2);
      res.type('html').send(html);
    });
  });
}

export function renderAdmin(res, view, dados = {}) {
  const ctx = { ...res.locals, ...dados };
  ejs.renderFile(path.join(VIEWS, 'admin', `${view}.ejs`), ctx, {}, (err, corpo) => {
    if (err) return res.req.next(err);
    ejs.renderFile(path.join(VIEWS, 'admin', 'layout.ejs'), { ...ctx, corpo }, {}, (err2, html) => {
      if (err2) return res.req.next(err2);
      res.type('html').send(html);
    });
  });
}

export function locaisDaRequisicao(req, res, next) {
  // nonce disponível para <script> inline futuro — exige também 'nonce-...' em script-src (ver csp.js)
  res.locals.nonce = gerarNonce();
  res.locals.appUrl = config.APP_URL ?? '';
  res.locals.anoAtual = new Date().getFullYear();
  res.locals.usuario = req.session?.usuarioId
    ? { id: req.session.usuarioId, role: req.session.role } : null;
  res.locals.cliente = req.session?.clienteId ? { id: req.session.clienteId } : null;
  next();
}
