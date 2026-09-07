// src/bootstrap.js
import { migrar } from './db/migrate.js';
import { semear } from './db/seed.js';

export async function inicializar({ semear: comSeed = false } = {}) {
  await migrar({ silent: false });
  if (comSeed) await semear();
}
