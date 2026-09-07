// src/public/js/admin/comum.js
import { toast, beep } from '../comum.js';

if (typeof window !== 'undefined') {
  const socket = window.io('/', { transports: ['websocket', 'polling'] });
  window.adminSocket = socket;

  socket.on('novo_agendamento', (a) => {
    toast(`Novo agendamento: ${a.cliente} — ${a.servico} ${a.horario}`, 'info');
    beep();
    window.dispatchEvent(new CustomEvent('admin:novo_agendamento', { detail: a }));
  });
  socket.on('agendamento_atualizado', (a) => {
    window.dispatchEvent(new CustomEvent('admin:agendamento_atualizado', { detail: a }));
  });
  socket.on('dashboard_tick', (c) => {
    window.dispatchEvent(new CustomEvent('admin:dashboard_tick', { detail: c }));
  });

  document.getElementById('admin-sair')?.addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    location.href = '/admin/login';
  });
}
