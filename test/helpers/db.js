// test/helpers/db.js
import { pool, schema } from '../../src/db/pool.js';
import { migrar } from '../../src/db/migrate.js';

const TABELAS = [
  'usuarios', 'clientes', 'servicos', 'configuracao', 'horario_funcionamento',
  'agenda_disponibilidade', 'bloqueios_agenda', 'agendamentos', 'horarios_lock',
  'templates_mensagem', 'mensagens_whatsapp', 'otp_codigos', 'logs_acesso',
  'session',
];

let migrado = false;

export async function prepararBanco() {
  if (!migrado) { await migrar({ silent: true }); migrado = true; }
  if (schema === 'public') throw new Error('harness de teste recusado no schema public');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`TRUNCATE ${TABELAS.join(', ')} RESTART IDENTITY CASCADE`);
    const { semear } = await import('../../src/db/seed.js');
    await semear(c);
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

export async function limparBanco() {
  if (schema === 'public') throw new Error('harness de teste recusado no schema public');
  await pool.query(`TRUNCATE ${TABELAS.join(', ')} RESTART IDENTITY CASCADE`);
}

export async function semearBase() { /* prepararBanco já semeia; mantido p/ compat */ }

export async function fecharBanco() {
  await pool.end();
}
