export function normalizarCelular(bruto) {
  const d = String(bruto ?? '').replace(/\D+/g, '');
  if (d.length >= 12 && d.length <= 13 && d.startsWith('55')) return d;
  if (d.length >= 10 && d.length <= 11) return `55${d}`;
  throw new Error('CELULAR_INVALIDO');
}
