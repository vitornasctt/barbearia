// scripts/sync-vendor.js
import { cp, mkdir, access } from 'node:fs/promises';
import path from 'node:path';

const dst = path.resolve('src/public/vendor');
await mkdir(dst, { recursive: true });

// socket.io client ships inside the socket.io package
const src = path.resolve('node_modules/socket.io/client-dist/socket.io.min.js');
try {
  await access(src);
  await cp(src, path.join(dst, 'socket.io.min.js'));
  console.log('vendor: socket.io.min.js atualizado');
} catch {
  console.warn('vendor: socket.io client não encontrado em node_modules (ok em CI sem deps de runtime)');
}

// Alpine is committed; just assert it exists
try {
  await access(path.join(dst, 'alpine.min.js'));
} catch {
  console.error('vendor: src/public/vendor/alpine.min.js ausente — baixe Alpine 3.x e commite');
  process.exit(1);
}
