import { EVENTOS } from './eventos.js';

export { EVENTOS };

const salaAgenda = (data) => `agenda:${data}`;

export function emitirHorarioReservado(io, { data, horario }) {
  if (!io) return;
  io.to(salaAgenda(data)).emit(EVENTOS.HORARIO_RESERVADO, { data, horario });
}

export function emitirHorarioLiberado(io, { data, horario }) {
  if (!io) return;
  io.to(salaAgenda(data)).emit(EVENTOS.HORARIO_LIBERADO, { data, horario });
}

export function emitirAgendaAtualizada(io, { data }) {
  if (!io) return;
  io.to(salaAgenda(data)).emit(EVENTOS.AGENDA_ATUALIZADA, { data });
}

export function emitirNovoAgendamento(io, ag) {
  if (!io) return;
  const { id, cliente, servico, data, horario, status } = ag;
  io.to('admin').emit(EVENTOS.NOVO_AGENDAMENTO, { id, cliente, servico, data, horario, status });
}

export function emitirAgendamentoAtualizado(io, { id, status }) {
  if (!io) return;
  io.to('admin').emit(EVENTOS.AGENDAMENTO_ATUALIZADO, { id, status });
}

export function emitirDashboardTick(io, contadores) {
  if (!io) return;
  io.to('admin').emit(EVENTOS.DASHBOARD_TICK, contadores);
}
