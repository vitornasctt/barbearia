// src/services/mapa.js
import { config } from '../config.js';
import { query } from '../db/pool.js';

export async function dadosMapa() {
  const { rows } = await query(
    `SELECT latitude::float8 AS latitude, longitude::float8 AS longitude, endereco FROM configuracao WHERE id=1`);
  const { latitude, longitude, endereco } = rows[0] ?? {};
  const temCoords = latitude != null && longitude != null;

  const destino = temCoords
    ? `${latitude},${longitude}`
    : encodeURIComponent(endereco ?? '');
  const comoChegarUrl = `https://www.google.com/maps/dir/?api=1&destination=${destino}`;

  if (config.GOOGLE_MAPS_API_KEY) {
    const q = temCoords ? `${latitude},${longitude}` : encodeURIComponent(endereco ?? '');
    return {
      provedor: 'google',
      embedUrl: `https://www.google.com/maps/embed/v1/place?key=${config.GOOGLE_MAPS_API_KEY}&q=${q}`,
      comoChegarUrl,
    };
  }
  const bbox = temCoords
    ? `${Number(longitude) - 0.01},${Number(latitude) - 0.01},${Number(longitude) + 0.01},${Number(latitude) + 0.01}`
    : '-180,-85,180,85';
  const marker = temCoords ? `&marker=${latitude},${longitude}` : '';
  return {
    provedor: 'osm',
    embedUrl: `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik${marker}`,
    comoChegarUrl,
  };
}
