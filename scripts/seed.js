// scripts/seed.js
import { semear } from '../src/db/seed.js';
import { fecharPool } from '../src/db/pool.js';

semear()
  .then(() => fecharPool())
  .then(() => console.log('seed aplicado'))
  .catch((err) => { console.error(err); process.exit(1); });
