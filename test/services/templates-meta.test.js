import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderizarTemplate } from '../../src/lib/template.js';

// espelha src/db/seed.js TEMPLATES — se o seed mudar, isto muda junto
const CORPOS = {
  confirmacao: `Olá, {{nome_cliente}}!
Seu agendamento para {{nome_servico}} está confirmado!
📅 Data: {{data}}
⏰ Horário: {{horario}}
📍 Local: {{endereco_barbearia}}
Para confirmar, responda SIM. Para cancelar ou remarcar, responda NÃO.`,
  lembrete_24h: `Olá, {{nome_cliente}}!
Lembrete: seu corte está agendado para amanhã às {{horario}}.
Estamos aguardando você! 💈`,
  pos_atendimento: `Olá, {{nome_cliente}}!
Obrigado por visitar nossa barbearia!
Esperamos vê-lo em breve. 💈
Indique para os amigos e ganhe desconto!`,
};

const CONHECIDAS = new Set(['nome_cliente', 'nome_servico', 'data', 'horario', 'endereco_barbearia', 'nome_barbearia']);
const VARS = { nome_cliente: 'Ana', nome_servico: 'Corte', data: '10/09', horario: '14:00', endereco_barbearia: 'Rua X, 1', nome_barbearia: 'Barbearia' };

for (const [chave, corpo] of Object.entries(CORPOS)) {
  test(`${chave}: só usa variáveis conhecidas`, () => {
    const usadas = [...corpo.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]);
    for (const u of usadas) assert.ok(CONHECIDAS.has(u), `variável desconhecida: ${u}`);
  });
  test(`${chave}: renderiza sem {{ sobrando`, () => {
    const out = renderizarTemplate(corpo, VARS);
    assert.doesNotMatch(out, /\{\{/);
  });
}
