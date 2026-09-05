// test/helpers/db.js
import { pool } from '../../src/db/pool.js';
import { migrar } from '../../src/db/migrate.js';

const TABELAS = [
  'usuarios', 'clientes', 'servicos', 'configuracao', 'horario_funcionamento',
  'agenda_disponibilidade', 'bloqueios_agenda', 'agendamentos', 'horarios_lock',
  'templates_mensagem', 'mensagens_whatsapp', 'otp_codigos', 'logs_acesso',
];

let migrado = false;

export async function prepararBanco() {
  if (!migrado) {
    await migrar({ silent: true });
    migrado = true;
  }
  await limparBanco();
}

export async function limparBanco() {
  await pool.query(`TRUNCATE ${TABELAS.join(', ')} RESTART IDENTITY CASCADE`);
}

export async function semearBase() {
  const { semear } = await import('../../src/db/seed.js'); // dinâmico: não exige a Task 8 no load
  await semear();
}

export async function fecharBanco() {
  await pool.end();
}
