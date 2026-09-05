// scripts/reset.js
import { migrar } from '../src/db/migrate.js';
import { pool } from '../src/db/pool.js';

const TABELAS = [
  'usuarios', 'clientes', 'servicos', 'configuracao', 'horario_funcionamento',
  'agenda_disponibilidade', 'bloqueios_agenda', 'agendamentos', 'horarios_lock',
  'templates_mensagem', 'mensagens_whatsapp', 'otp_codigos', 'logs_acesso',
];

await migrar({ silent: true });
await pool.query(`TRUNCATE ${TABELAS.join(', ')} RESTART IDENTITY CASCADE`);
const { semear } = await import('../src/db/seed.js'); // dinâmico: Task 8 preenche
await semear();
await pool.end();
console.log('banco recriado e semeado');
