import type { FastifyInstance } from 'fastify';
import type { AppConfig } from './config.js';

export function readinessSnapshot(
  config: AppConfig,
  probes: { database: boolean; objectStorage: boolean; adminCredential?: boolean },
) {
  const production = config.production;
  const encryptionConfigured = Boolean(
    config.fieldEncryptionKey ?? production?.fieldEncryptionKey,
  );
  if (config.pilot) return {
    ready: probes.database && probes.objectStorage && encryptionConfigured
      && (config.nodeEnv !== 'production' || (Boolean(production) && probes.adminCredential !== false)),
    database: probes.database,
    objectStorage: probes.objectStorage,
    encryption: encryptionConfigured,
    paymentProvider: 'manual' as const,
    objectStorageProvider: config.nodeEnv === 'production'
      ? 's3' as const
      : config.pilot.evidenceDir ? 'filesystem' as const : 'unconfigured' as const,
    notificationProvider: 'disabled' as const,
  };
  const result = {
    ready: probes.database && probes.objectStorage && Boolean(production),
    database: probes.database,
    objectStorage: probes.objectStorage,
    encryption: encryptionConfigured,
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
  objectStorageProbe: () => Promise<boolean>,
  adminCredentialProbe: () => Promise<boolean> = async () => true,
) {
  app.get('/health/live', async () => ({ alive: true }));
  app.get('/health/ready', async (_request, reply) => {
    const [database, objectStorage, adminCredential] = await Promise.all([
      databaseProbe(), objectStorageProbe(), adminCredentialProbe(),
    ]);
    const snapshot = readinessSnapshot(config, { database, objectStorage, adminCredential });
    return reply.code(snapshot.ready ? 200 : 503).send(snapshot);
  });
}
