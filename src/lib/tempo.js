export function paraMinutos(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function paraHHMM(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function adicionarMinutos(hhmm, delta) {
  return paraHHMM(paraMinutos(hhmm) + delta);
}

export function sobrepoe(iniA, fimA, iniB, fimB) {
  const a1 = paraMinutos(iniA), a2 = paraMinutos(fimA);
  const b1 = paraMinutos(iniB), b2 = paraMinutos(fimB);
  return a1 < b2 && b1 < a2;
}
