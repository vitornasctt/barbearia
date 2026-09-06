function pad(n) { return String(n).padStart(2, '0'); }

export function hoje() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function inicioDoMes(ano, mes) {
  return `${ano}-${pad(mes)}-01`;
}

export function fimDoMes(ano, mes) {
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate(); // mes é 1-based; dia 0 = último do mês anterior
  return `${ano}-${pad(mes)}-${pad(ultimo)}`;
}

export function ehData(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [a, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d));
  return dt.getUTCFullYear() === a && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
