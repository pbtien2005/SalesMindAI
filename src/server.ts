import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';

const env = loadEnv();

const app = buildApp({
  logger: { level: env.NODE_ENV === 'production' ? 'info' : 'debug' },
});

try {
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
