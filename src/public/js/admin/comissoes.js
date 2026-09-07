// src/public/js/admin/comissoes.js
import { pedirJson } from '../comum.js';

function painelComissoes() {
  const hoje = new Date();
  return {
    mes: hoje.getMonth() + 1, ano: hoje.getFullYear(),
    linhas: [], total: {},
    fmt(v) { return v == null ? '–' : 'R$ ' + Number(v).toFixed(2); },
    async init() { await this.carregar(); },
    async carregar() {
      const { ok, corpo } = await pedirJson(`/api/admin/comissoes?mes=${this.mes}&ano=${this.ano}`);
      if (!ok) return;
      const r = corpo.relatorio || corpo;
      this.linhas = r.linhas || r.itens || [];
      this.total = r.total || r.totais || {};
    },
  };
}

if (typeof window !== 'undefined') {
  window.painelComissoes = painelComissoes;
  document.addEventListener('alpine:init', () => window.Alpine.data('painelComissoes', painelComissoes));
}
