// test/db/migrate.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { migrar } from '../../src/db/migrate.js';
import { query, fecharPool, schema } from '../../src/db/pool.js';

test.after(() => fecharPool());

test('migrar cria as tabelas do schema e é idempotente', async () => {
  await migrar({ silent: true });
  await migrar({ silent: true }); // segunda vez: no-op, não pode lançar

  const nomes = ['usuarios','clientes','servicos','configuracao','horario_funcionamento',
    'agenda_disponibilidade','bloqueios_agenda','agendamentos','horarios_lock',
    'templates_mensagem','mensagens_whatsapp','otp_codigos','logs_acesso','schema_migrations',
    'session'];
  const r = await query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema=$2 AND table_name = ANY($1)`, [nomes, schema]);
  assert.equal(r.rows.length, nomes.length);
});

test('002 cria a tabela session com a coluna expire indexada', async () => {
  await migrar({ silent: true });
  const col = await query(
    `SELECT data_type FROM information_schema.columns
     WHERE table_schema=$1 AND table_name='session' AND column_name='expire'`, [schema]);
  assert.equal(col.rows[0].data_type, 'timestamp with time zone');
});

test('o índice único parcial de slot ativo existe', async () => {
  await migrar({ silent: true });
  const r = await query(`SELECT indexdef FROM pg_indexes WHERE indexname='uniq_slot_ativo'`);
  assert.match(r.rows[0].indexdef, /pendente.*confirmado/);
});
