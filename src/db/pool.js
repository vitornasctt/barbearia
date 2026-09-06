// src/db/pool.js
import pg from 'pg';
import { config } from '../config.js';

export const schema = config.NODE_ENV === 'test' ? config.TEST_SCHEMA : 'public';

export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  options: `-c search_path=${schema}`,
  max: 10,
});

// Encerramento idempotente: `server.js#parar()` fecha o pool no shutdown gracioso
// e os helpers de teste também chamam `pool.end()` no `test.after`. Sem isso o
// segundo `end()` do pg-pool lança "Called end on pool more than once".
const _poolEnd = pool.end.bind(pool);
let _encerrando = null;
pool.end = () => (_encerrando ||= _poolEnd());

export function query(text, params) {
  return pool.query(text, params);
}

export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const resultado = await fn(client);
    await client.query('COMMIT');
    client.release();
    return resultado;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* conexão morta: mantém o erro original */ }
    client.release(err);
    throw err;
  }
}

export function fecharPool() {
  return pool.end();
}
