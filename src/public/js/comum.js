export async function pedirJson(url, opcoes = {}) {
  const resp = await fetch(url, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json', ...(opcoes.body ? { 'Content-Type': 'application/json' } : {}), ...(opcoes.headers || {}) },
    ...opcoes,
  });
  let corpo = null;
  try { corpo = await resp.json(); } catch { /* sem corpo */ }
  return { ok: resp.ok, status: resp.status, corpo };
}

export function formatarMMSS(segundos) {
  const s = Math.max(0, Math.floor(segundos));
  const m = Math.floor(s / 60);
  return String(m).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

export function toast(msg, tipo = 'info') {
  const el = document.createElement('div');
  el.className = 'toast toast-' + tipo;
  el.textContent = msg;
  el.setAttribute('role', 'status');
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

export function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    o.frequency.value = 660; o.connect(ctx.destination); o.start();
    setTimeout(() => { o.stop(); ctx.close(); }, 120);
  } catch { /* áudio bloqueado — silencioso */ }
}
