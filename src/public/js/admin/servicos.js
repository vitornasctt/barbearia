// src/public/js/admin/servicos.js
import { pedirJson, toast } from '../comum.js';

function painelServicos() {
  return {
    itens: [],
    novo: { nome: '', duracao_minutos: 30, preco: 0, comissao_percentual: 0 },
    async init() { await this.carregar(); },
    async carregar() {
      const { ok, corpo } = await pedirJson('/api/admin/servicos');
      if (ok) this.itens = corpo.servicos || corpo;
    },
    async criar() {
      const { ok } = await pedirJson('/api/admin/servicos', { method: 'POST', body: JSON.stringify(this.novo) });
      if (ok) { toast('Serviço criado.', 'info'); this.novo = { nome: '', duracao_minutos: 30, preco: 0, comissao_percentual: 0 }; this.carregar(); }
      else toast('Não foi possível criar.', 'erro');
    },
    async salvar(s) {
      const { ok } = await pedirJson('/api/admin/servicos/' + s.id, {
        method: 'PATCH',
        body: JSON.stringify({ nome: s.nome, duracao_minutos: s.duracao_minutos, preco: s.preco, comissao_percentual: s.comissao_percentual, ativo: s.ativo }),
      });
      toast(ok ? 'Salvo.' : 'Falha ao salvar.', ok ? 'info' : 'erro');
    },
    async remover(s) {
      if (!confirm('Remover ' + s.nome + '?')) return;
      const { ok } = await pedirJson('/api/admin/servicos/' + s.id, { method: 'DELETE' });
      if (ok) { toast('Removido (ou inativado se houver histórico).', 'info'); this.carregar(); }
    },
  };
}

if (typeof window !== 'undefined') {
  window.painelServicos = painelServicos;
  document.addEventListener('alpine:init', () => window.Alpine.data('painelServicos', painelServicos));
}
