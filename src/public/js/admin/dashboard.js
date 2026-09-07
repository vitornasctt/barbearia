// src/public/js/admin/dashboard.js
import { pedirJson } from '../comum.js';

function painelDashboard() {
  return {
    d: {},
    fmtBRL(v) { return v == null ? '–' : 'R$ ' + Number(v).toFixed(2); },
    async init() {
      await this.recarregar();
      window.addEventListener('admin:dashboard_tick', (e) => { this.d = { ...this.d, ...e.detail }; });
      window.addEventListener('admin:novo_agendamento', () => this.recarregar());
    },
    async recarregar() {
      const { ok, corpo } = await pedirJson('/api/admin/dashboard');
      if (ok) this.d = corpo.dashboard || corpo;
    },
  };
}

if (typeof window !== 'undefined') {
  window.painelDashboard = painelDashboard;
  document.addEventListener('alpine:init', () => window.Alpine.data('painelDashboard', painelDashboard));
}
