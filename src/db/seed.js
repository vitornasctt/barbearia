// src/db/seed.js
import { hashSenha } from '../auth/senha.js';
import { pool } from './pool.js';
import { config } from '../config.js';

const TEMPLATES = [
  ['confirmacao', 'Confirmação de agendamento',
`Olá, {{nome_cliente}}!
Seu agendamento para {{nome_servico}} está confirmado!
📅 Data: {{data}}
⏰ Horário: {{horario}}
📍 Local: {{endereco_barbearia}}
Para confirmar, responda SIM. Para cancelar ou remarcar, responda NÃO.`],
  ['lembrete_24h', 'Lembrete 24h',
`Olá, {{nome_cliente}}!
Lembrete: seu corte está agendado para amanhã às {{horario}}.
Estamos aguardando você! 💈`],
  ['pos_atendimento', 'Pós-atendimento',
`Olá, {{nome_cliente}}!
Obrigado por visitar nossa barbearia!
Esperamos vê-lo em breve. 💈
Indique para os amigos e ganhe desconto!`],
];

const SERVICOS = [
  ['Corte', 35, 45.0, 50.0],
  ['Barba', 35, 35.0, 50.0],
  ['Corte + Barba', 70, 70.0, 50.0],
];

export async function semear(exec = pool) {
  await exec.query(
    `INSERT INTO configuracao (id, nome_barbearia, telefone_whatsapp, endereco, latitude, longitude)
     VALUES (1, 'Minha Barbearia', '5511999990000', 'Rua Exemplo, 123 - Sao Paulo', -23.55, -46.63)
     ON CONFLICT (id) DO NOTHING`,
  );

  for (let dow = 0; dow <= 6; dow++) {
    await exec.query(
      `INSERT INTO horario_funcionamento (dia_semana, aberto, abre, fecha)
       VALUES ($1, $2, '09:00', '19:30') ON CONFLICT (dia_semana) DO NOTHING`,
      [dow, dow !== 0],
    );
  }

  const hash = await hashSenha(config.ADMIN_SENHA);
  const admin = await exec.query(
    `INSERT INTO usuarios (nome, email, senha_hash, role)
     VALUES ('Dono', $1, $2, 'admin')
     ON CONFLICT (email) DO UPDATE SET nome = usuarios.nome
     RETURNING id`,
    [config.ADMIN_EMAIL, hash],
  );
  await exec.query(
    `UPDATE configuracao SET barbeiro_padrao_id = $1
     WHERE id = 1 AND barbeiro_padrao_id IS NULL`,
    [admin.rows[0].id],
  );

  for (const [nome, dur, preco, com] of SERVICOS) {
    await exec.query(
      `INSERT INTO servicos (nome, duracao_minutos, preco, comissao_percentual)
       SELECT $1::varchar, $2, $3, $4
       WHERE NOT EXISTS (SELECT 1 FROM servicos WHERE nome = $1)`,
      [nome, dur, preco, com],
    );
  }

  for (const [chave, titulo, corpo] of TEMPLATES) {
    await exec.query(
      `INSERT INTO templates_mensagem (chave, titulo, corpo)
       VALUES ($1, $2, $3) ON CONFLICT (chave) DO NOTHING`,
      [chave, titulo, corpo],
    );
  }
}
