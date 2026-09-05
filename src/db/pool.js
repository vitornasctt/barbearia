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

export function query(text, params) {
  return pool.query(text, params);
}

export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const resultado = await fn(client);
    await client.query('COMMIT');
    return resultado;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export function fecharPool() {
  return pool.end();
}
