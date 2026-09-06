// test/services/mapa.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepararBanco, semearBase, fecharBanco } from '../helpers/db.js';
import { query } from '../../src/db/pool.js';
import { dadosMapa } from '../../src/services/mapa.js';

test.after(() => fecharBanco());
test.beforeEach(async () => { await prepararBanco(); await semearBase(); });

test('sem GOOGLE_MAPS_API_KEY usa OSM e monta comoChegarUrl', async () => {
  await query(`UPDATE configuracao SET latitude=-20.32, longitude=-40.29, endereco='Rua X, 1' WHERE id=1`);
  const d = await dadosMapa();
  assert.equal(d.provedor, 'osm');
  assert.match(d.embedUrl, /openstreetmap/);
  assert.match(d.comoChegarUrl, /destination=-20.32,-40.29/);
});
