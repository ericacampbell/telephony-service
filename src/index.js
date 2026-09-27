import { buildServer } from './server.js';
import { seedDefaultTenant } from './tenants.js';
import { requireEnv } from './config.js';
import { hasDb } from './db.js';
import { dbStore } from './store.js';
import { nullStore } from './pipeline.js';

requireEnv('GROQ_API_KEY', 'ANTHROPIC_API_KEY');

const tenants = await seedDefaultTenant();
const app = buildServer({
  logger: { level: process.env.LOG_LEVEL || 'info' },
  store: hasDb() ? dbStore : nullStore,
});

if (!hasDb()) {
  app.log.warn('DATABASE_URL is not set — tenants are in memory and nothing is persisted');
}

const port = Number(process.env.PORT) || 3000;
await app.listen({ port, host: '0.0.0.0' });

const base = process.env.PUBLIC_URL || `http://localhost:${port}`;
for (const t of tenants) {
  app.log.info(`Try-it link for ${t.slug}: ${base}/t/${t.slug}/${t.shareToken}`);
}
