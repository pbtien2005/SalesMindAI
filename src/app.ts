import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

/** Tạo app Fastify. Tách khỏi server.ts để test bằng app.inject(). */
export function buildApp(opts: FastifyServerOptions = {}): FastifyInstance {
  const app = Fastify(opts);

  app.get('/healthz', async () => ({ status: 'ok' }));

  return app;
}
