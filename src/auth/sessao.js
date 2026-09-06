// src/auth/sessao.js
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { pool, schema } from '../db/pool.js';
import { config } from '../config.js';

const PgStore = connectPgSimple(session);

export function criarSessaoMiddleware() {
  return session({
    name: 'barbearia.sid',
    store: new PgStore({
      pool,
      schemaName: schema,
      tableName: 'session',
      createTableIfMissing: false,
      pruneSessionInterval: false,
    }),
    secret: config.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.NODE_ENV === 'production' || config.COOKIE_SECURE === '1',
      maxAge: 30 * 24 * 3600 * 1000,
    },
  });
}
