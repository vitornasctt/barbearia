// src/public/js/admin/bloqueios.js
import { pedirJson, toast } from '../comum.js';

function painelBloqueios() {
  return {
    itens: [],
    novo: { data: '', diaInteiro: true, inicio: '', fim: '', motivo: '' },
    async init() { await this.carregar(); },
    async carregar() {
      const hoje = new Date();
      const de = `${hoje.getFullYear()}-01-01`;
      const ate = `${hoje.getFullYear() + 1}-12-31`;
      const { ok, corpo } = await pedirJson(`/api/admin/bloqueios?de=${de}&ate=${ate}`);
      if (ok) this.itens = corpo.bloqueios || corpo;
    },
    async criar() {
      const b = this.novo;
      const body = {
        data: b.data, motivo: b.motivo,
        ...(b.diaInteiro ? {} : { hora_inicio: b.inicio, hora_fim: b.fim }),
      };
      const { ok } = await pedirJson('/api/admin/bloqueios', { method: 'POST', body: JSON.stringify(body) });
      if (ok) { toast('Bloqueio criado.', 'info'); this.novo = { data: '', diaInteiro: true, inicio: '', fim: '', motivo: '' }; this.carregar(); }
      else toast('Não foi possível criar.', 'erro');
    },
    async remover(b) {
      const { ok } = await pedirJson('/api/admin/bloqueios/' + b.id, { method: 'DELETE' });
      if (ok) { toast('Removido.', 'info'); this.carregar(); }
    },
  };
}

if (typeof window !== 'undefined') {
  window.painelBloqueios = painelBloqueios;
  document.addEventListener('alpine:init', () => window.Alpine.data('painelBloqueios', painelBloqueios));
}
