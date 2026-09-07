// src/public/js/admin/agendamentos.js
import { pedirJson, toast } from '../comum.js';

function painelAgendamentos() {
  return {
    itens: [], pagina: 1,
    filtro: { data: '', status: '', cliente: '' },
    async init() {
      await this.buscar();
      window.addEventListener('admin:novo_agendamento', () => this.buscar());
      window.addEventListener('admin:agendamento_atualizado', (e) => {
        const i = this.itens.findIndex((x) => x.id === e.detail.id);
        if (i >= 0) this.itens[i] = { ...this.itens[i], status: e.detail.status };
      });
    },
    async buscar() {
      const q = new URLSearchParams({ page: this.pagina });
      if (this.filtro.data) q.set('data', this.filtro.data);
      if (this.filtro.status) q.set('status', this.filtro.status);
      if (this.filtro.cliente) q.set('cliente', this.filtro.cliente);
      const { ok, corpo } = await pedirJson('/api/admin/agendamentos?' + q);
      if (ok) this.itens = corpo.agendamentos || corpo.itens || corpo;
    },
    async mudarStatus(a, status) {
      const { ok } = await pedirJson(`/api/admin/agendamentos/${a.id}/status`, {
        method: 'PATCH', body: JSON.stringify({ status }),
      });
      if (ok) { toast('Status atualizado.', 'info'); this.buscar(); }
      else toast('Não foi possível atualizar.', 'erro');
    },
    async cancelar(a) {
      const motivo = prompt('Motivo:') || '';
      const { ok } = await pedirJson(`/api/admin/agendamentos/${a.id}/status`, {
        method: 'PATCH', body: JSON.stringify({ status: 'cancelado', motivo }),
      });
      if (ok) { toast('Cancelado.', 'info'); this.buscar(); }
    },
    async enviarWhatsapp(a) {
      const { ok } = await pedirJson('/api/admin/mensagens/enviar', {
        method: 'POST', body: JSON.stringify({ agendamento_id: a.id, template_chave: 'confirmacao' }),
      });
      toast(ok ? 'Mensagem enfileirada.' : 'Falha ao enfileirar.', ok ? 'info' : 'erro');
    },
  };
}

if (typeof window !== 'undefined') {
  window.painelAgendamentos = painelAgendamentos;
  document.addEventListener('alpine:init', () => window.Alpine.data('painelAgendamentos', painelAgendamentos));
}
