import type { FastifyInstance } from 'fastify';
import type { AppConfig } from './config.js';

export function readinessSnapshot(config: AppConfig, probes: { database: boolean }) {
  const production = config.production;
  const result = {
    ready: probes.database && Boolean(production),
    database: probes.database,
    encryption: Boolean(production?.fieldEncryptionKey),
    paymentProvider: production ? 'wechat' as const : 'fake' as const,
    objectStorageProvider: production ? 's3' as const : 'fake' as const,
    notificationProvider: production ? 'wechat' as const : 'console' as const,
  };
  return result;
}

export function registerHealthRoutes(
  app: FastifyInstance,
  config: AppConfig,
  databaseProbe: () => Promise<boolean>,
) {
  app.get('/health/live', async () => ({ alive: true }));
  app.get('/health/ready', async (_request, reply) => {
    const snapshot = readinessSnapshot(config, { database: await databaseProbe() });
    return reply.code(snapshot.ready ? 200 : 503).send(snapshot);
  });
}
