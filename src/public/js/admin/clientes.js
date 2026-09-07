// src/public/js/admin/clientes.js
import { pedirJson, toast } from '../comum.js';

function painelClientes() {
  return {
    busca: '', itens: [], ficha: null,
    async init() { await this.buscar(); },
    async buscar() {
      const { ok, corpo } = await pedirJson('/api/admin/clientes?busca=' + encodeURIComponent(this.busca));
      if (ok) this.itens = corpo.itens || corpo.clientes || corpo;
    },
    async abrir(c) {
      const { ok, corpo } = await pedirJson('/api/admin/clientes/' + c.id);
      if (ok) this.ficha = { ...(corpo.cliente || corpo), agendamentos: corpo.agendamentos?.itens || corpo.agendamentos || [] };
    },
    async anonimizar() {
      if (!confirm('Anonimizar este cliente? Ação irreversível.')) return;
      const { ok } = await pedirJson('/api/admin/clientes/' + this.ficha.id + '/anonimizar', { method: 'POST' });
      if (ok) { toast('Cliente anonimizado.', 'info'); this.ficha = null; this.buscar(); }
      else toast('Não foi possível anonimizar.', 'erro');
    },
  };
}

if (typeof window !== 'undefined') {
  window.painelClientes = painelClientes;
  document.addEventListener('alpine:init', () => window.Alpine.data('painelClientes', painelClientes));
}
