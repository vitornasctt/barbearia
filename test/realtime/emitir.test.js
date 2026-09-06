import test from 'node:test';
import assert from 'node:assert/strict';
import { EVENTOS, emitirHorarioReservado, emitirAgendaAtualizada, emitirNovoAgendamento } from '../../src/realtime/emitir.js';

function ioFake() {
  const chamadas = [];
  return {
    chamadas,
    to(sala) { return { emit: (ev, payload) => chamadas.push({ sala, ev, payload }) }; },
  };
}

test('emitirHorarioReservado vai para a sala da data', () => {
  const io = ioFake();
  emitirHorarioReservado(io, { data: '2026-09-10', horario: '09:00' });
  assert.deepEqual(io.chamadas[0], { sala: 'agenda:2026-09-10', ev: EVENTOS.HORARIO_RESERVADO, payload: { data: '2026-09-10', horario: '09:00' } });
});

test('emitirNovoAgendamento vai para admin com os campos certos', () => {
  const io = ioFake();
  emitirNovoAgendamento(io, { id: 7, cliente: 'Ana', servico: 'Corte', data: '2026-09-10', horario: '09:00', status: 'pendente', extra: 'ignora' });
  assert.equal(io.chamadas[0].sala, 'admin');
  assert.deepEqual(io.chamadas[0].payload, { id: 7, cliente: 'Ana', servico: 'Corte', data: '2026-09-10', horario: '09:00', status: 'pendente' });
});

test('io falsy => no-op', () => {
  assert.doesNotThrow(() => emitirAgendaAtualizada(null, { data: '2026-09-10' }));
});
