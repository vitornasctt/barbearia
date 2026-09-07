// src/public/js/admin/configuracao.js
import { pedirJson, toast } from '../comum.js';
const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

function painelConfiguracao() {
  return {
    c: {}, erro: '',
    diaNome(d) { return DIAS[d]; },
    async init() {
      const { ok, corpo } = await pedirJson('/api/admin/configuracao');
      if (ok) this.c = corpo.configuracao || corpo;
    },
    async salvar() {
      this.erro = '';
      const { ok, corpo } = await pedirJson('/api/admin/configuracao', {
        method: 'PUT', body: JSON.stringify(this.c),
      });
      if (ok) toast('Configuração salva.', 'info');
      else this.erro = (corpo && corpo.campos && corpo.campos[0]?.mensagem) || 'Não foi possível salvar.';
    },
  };
}

if (typeof window !== 'undefined') {
  window.painelConfiguracao = painelConfiguracao;
  document.addEventListener('alpine:init', () => window.Alpine.data('painelConfiguracao', painelConfiguracao));
}
