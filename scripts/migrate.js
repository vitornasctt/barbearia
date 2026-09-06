// scripts/migrate.js
import { migrar } from '../src/db/migrate.js';
import { fecharPool } from '../src/db/pool.js';

migrar()
  .then(() => fecharPool())
  .then(() => console.log('migrations em dia'))
  .catch((err) => { console.error(err); process.exit(1); });
