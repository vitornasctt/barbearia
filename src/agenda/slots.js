import { paraMinutos, paraHHMM } from '../lib/tempo.js';

export function gerarSlots({ abre, fecha, intervaloMinutos, duracaoServico }) {
  const inicio = paraMinutos(abre);
  const fim = paraMinutos(fecha);
  const slots = [];
  for (let t = inicio; t + duracaoServico <= fim; t += intervaloMinutos) {
    slots.push(paraHHMM(t));
  }
  return slots;
}
