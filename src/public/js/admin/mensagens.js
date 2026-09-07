// src/public/js/admin/mensagens.js
import { pedirJson } from '../comum.js';

function painelMensagens() {
  return {
    agendamentoId: null, itens: [],
    async init() { await this.carregar(); },
    async carregar() {
      const q = this.agendamentoId ? ('?agendamento_id=' + this.agendamentoId) : '';
      const { ok, corpo } = await pedirJson('/api/admin/mensagens' + q);
      if (ok) this.itens = corpo.itens || corpo.mensagens || corpo;
    },
  };
}

if (typeof window !== 'undefined') {
  window.painelMensagens = painelMensagens;
  document.addEventListener('alpine:init', () => window.Alpine.data('painelMensagens', painelMensagens));
}
