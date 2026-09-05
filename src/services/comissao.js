export function calcularComissao(preco, percentual) {
  const p = Number(preco);
  const pct = Number(percentual);
  return Math.round(p * pct) / 100;
}
