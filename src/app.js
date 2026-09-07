// src/app.js
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { config } from './config.js';
import { diretivasCsp } from './http/csp.js';
import { errorHandler } from './http/erros.js';
import { criarSessaoMiddleware } from './auth/sessao.js';
import { saude } from './routes/saude.js';
import { auth } from './routes/auth.js';
import { anexarSessaoAnonima } from './auth/middleware.js';
import { exigirOrigemConfiavel } from './http/origem.js';
import { publicas } from './routes/publicas.js';
import { clienteApi } from './routes/clienteApi.js';
import { requireCliente } from './auth/middleware.js';
import { adminApi } from './routes/adminApi.js';
import { requireEquipe } from './auth/middleware.js';
import { webhooks } from './routes/webhooks.js';
import { paginas, erroPagina } from './routes/paginas.js';
import { adminPaginas } from './routes/adminPaginas.js';
import { locaisDaRequisicao } from './http/render.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');

// As tasks seguintes de rota editam SÓ esta função (inserem app.use antes do comentário-âncora).
function montarRotas(app) {
  app.use(saude);
  app.use('/api/auth', anexarSessaoAnonima, exigirOrigemConfiavel, auth);
  app.use('/api/agenda', anexarSessaoAnonima, exigirOrigemConfiavel, publicas);
  app.use('/api/cliente', anexarSessaoAnonima, exigirOrigemConfiavel, requireCliente, clienteApi);
  app.use('/api/admin', anexarSessaoAnonima, exigirOrigemConfiavel, requireEquipe, adminApi);
  // <-- ROTAS P2 (não remover esta linha)
}

export function buildApp({ io = null } = {}) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(pinoHttp({
    level: config.LOG_LEVEL,
    redact: ['req.body.senha', 'req.body.nova_senha', 'req.body.codigo', 'req.headers.cookie', 'req.headers.authorization'],
  }));
  app.use((req, res, next) => { req.io = io; next(); });
  app.use(helmet({
    contentSecurityPolicy: { useDefaults: false, directives: diretivasCsp(config) },
  }));
  app.use('/', express.static(PUBLIC_DIR, { maxAge: '5m' }));
  app.use('/webhooks', (req, res, next) => { req.io = io; next(); }, webhooks);
  app.use(express.json({ limit: '100kb' }));
  app.use(criarSessaoMiddleware());
  app.use(locaisDaRequisicao);

  app.use('/', paginas);
  montarRotas(app);
  app.use('/admin', adminPaginas);

  app.use((err, req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/webhooks')) return next(err);
    return erroPagina(err, req, res, next);
  });
  app.use((req, res) => res.status(404).json({ erro: 'NAO_ENCONTRADO' }));
  app.use(errorHandler);
  return app;
}
