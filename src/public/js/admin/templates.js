// src/public/js/admin/templates.js
import { pedirJson, toast } from '../comum.js';

export function previewTemplate(corpo, vars) {
  return String(corpo).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (k in vars ? String(vars[k]) : `{{${k}}}`));
}

const EXEMPLO = { nome: 'Ana', servico: 'Corte', data: '10/09', hora: '14:00', barbearia: 'Barbearia' };

function painelTemplates() {
  return {
    itens: [],
    async init() {
      const { ok, corpo } = await pedirJson('/api/admin/templates');
      if (ok) this.itens = corpo.templates || corpo;
    },
    preview(t) { return previewTemplate(t.corpo || '', EXEMPLO); },
    async salvar(t) {
      const { ok } = await pedirJson('/api/admin/templates', {
        method: 'PUT', body: JSON.stringify({ chave: t.chave, corpo: t.corpo }),
      });
      toast(ok ? 'Template salvo.' : 'Falha ao salvar.', ok ? 'info' : 'erro');
    },
  };
}

if (typeof window !== 'undefined') {
  window.painelTemplates = painelTemplates;
  document.addEventListener('alpine:init', () => window.Alpine.data('painelTemplates', painelTemplates));
}
