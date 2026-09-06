// src/app.js
import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { config } from './config.js';
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
import { locaisDaRequisicao } from './http/render.js';

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
    redact: ['req.body.senha', 'req.headers.cookie', 'req.headers.authorization'],
  }));
  app.use((req, res, next) => { req.io = io; next(); });
  app.use(helmet({ contentSecurityPolicy: false })); // CSP entra no P3 com os assets
  app.use('/', express.static('src/public', { maxAge: '1h' }));
  app.use('/webhooks', (req, res, next) => { req.io = io; next(); }, webhooks);
  app.use(express.json({ limit: '100kb' }));
  app.use(criarSessaoMiddleware());
  app.use(locaisDaRequisicao);

  montarRotas(app);

  app.use((req, res) => res.status(404).json({ erro: 'NAO_ENCONTRADO' }));
  app.use(errorHandler);
  return app;
}
