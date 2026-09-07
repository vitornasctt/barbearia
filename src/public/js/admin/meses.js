// src/public/js/admin/meses.js
import { pedirJson, toast } from '../comum.js';
const NOMES = ['', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function painelMeses() {
  return {
    ano: new Date().getFullYear(),
    meses: [],
    nomeMes(m) { return NOMES[m]; },
    async init() { await this.carregar(); },
    async carregar() {
      const { ok, corpo } = await pedirJson('/api/admin/disponibilidade?ano=' + this.ano);
      if (ok) this.meses = corpo.meses || corpo;
    },
    async salvar(m, status) {
      const { ok } = await pedirJson('/api/admin/disponibilidade', {
        method: 'POST',
        body: JSON.stringify({ ano: this.ano, mes: m.mes, status, limite_por_dia: m.limite_por_dia ?? null }),
      });
      if (ok) { toast('Mês atualizado.', 'info'); this.carregar(); }
      else toast('Não foi possível salvar.', 'erro');
    },
  };
}

if (typeof window !== 'undefined') {
  window.painelMeses = painelMeses;
  document.addEventListener('alpine:init', () => window.Alpine.data('painelMeses', painelMeses));
}
