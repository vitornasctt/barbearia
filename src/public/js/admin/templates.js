// src/public/js/admin/templates.js
import { pedirJson, toast } from '../comum.js';

export function previewTemplate(corpo, vars) {
  return String(corpo).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (k in vars ? String(vars[k]) : `{{${k}}}`));
}

const EXEMPLO = {
  nome_cliente: 'Ana', nome_servico: 'Corte', data: '10/09',
  horario: '14:00', endereco_barbearia: 'Rua Exemplo, 123', nome_barbearia: 'Barbearia',
};

function painelTemplates() {
  return {
    itens: [],
    async init() {
      const { ok, corpo } = await pedirJson('/api/admin/templates');
      if (ok) this.itens = corpo.templates || corpo;
    },
    preview(t) { return previewTemplate(t.corpo || '', EXEMPLO); },
    async salvar(t) {
      const { ok } = await pedirJson('/api/admin/templates/' + encodeURIComponent(t.chave), {
        method: 'PUT', body: JSON.stringify({ titulo: t.titulo, corpo: t.corpo, ativo: t.ativo }),
      });
      toast(ok ? 'Template salvo.' : 'Falha ao salvar.', ok ? 'info' : 'erro');
    },
  };
}

if (typeof window !== 'undefined') {
  window.painelTemplates = painelTemplates;
  document.addEventListener('alpine:init', () => window.Alpine.data('painelTemplates', painelTemplates));
}
