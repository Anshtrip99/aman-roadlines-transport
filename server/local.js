import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });
import { app, ensureDatabaseConnected } from './app.js';
import { ensureAtlasCurrentIpAllowed } from './atlas-network.js';

const port = Number(process.env.PORT || 4000);
async function start() {
  await ensureAtlasCurrentIpAllowed();
  await ensureDatabaseConnected();
  app.listen(port, '0.0.0.0', () => console.log('Aman Roadlines server listening on port ' + port));
}
start().catch(error => { console.error(error); process.exit(1); });
