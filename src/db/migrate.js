// src/db/migrate.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, schema } from './pool.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export async function migrar({ silent = false } = {}) {
  // `schema` vem do config, validado por regex (identificador SQL seguro)
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);

  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    nome TEXT PRIMARY KEY,
    aplicada_em TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);

  const { rows } = await pool.query('SELECT nome FROM schema_migrations');
  const aplicadas = new Set(rows.map((r) => r.nome));
  const arquivos = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

  for (const arquivo of arquivos) {
    if (aplicadas.has(arquivo)) continue;
    const sql = fs.readFileSync(path.join(dir, arquivo), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (nome) VALUES ($1)', [arquivo]);
      await client.query('COMMIT');
      if (!silent) console.log(`migração aplicada: ${arquivo}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`falha na migração ${arquivo}: ${err.message}`);
    } finally {
      client.release();
    }
  }
}
