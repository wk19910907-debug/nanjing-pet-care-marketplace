import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAwsS3Signer } from './adapters/aws-s3-signer.js';
import type { S3Signer } from './adapters/s3-object-storage.js';
import { loadConfig, type AppConfig, type ObjectStorageConfig } from './config.js';
import type { PilotCompositionOverrides } from './pilot/composition.js';

export function resolvePilotServerOverrides(
  config: AppConfig,
  overrides: PilotCompositionOverrides,
  signerFactory: (storage: ObjectStorageConfig) => S3Signer = createAwsS3Signer,
): PilotCompositionOverrides {
  if (config.nodeEnv !== 'production' || overrides.s3Signer) return overrides;
  if (!config.production) throw new Error('PILOT_PRODUCTION_CONFIG_REQUIRED');
  return { ...overrides, s3Signer: signerFactory(config.production.objectStorage) };
}

export async function runPilotServer(
  environment: Record<string, string | undefined> = process.env,
  overrides: PilotCompositionOverrides = {},
) {
  const config = loadConfig(environment);
  if (!config.pilot) throw new Error('PILOT_MODE_REQUIRED');
  const { createPilotApplication } = await import('./pilot/composition.js');
  const application = await createPilotApplication(
    config,
    resolvePilotServerOverrides(config, overrides),
  );
  try {
    const readiness = await application.app.inject({ method: 'GET', url: '/health/ready' });
    if (readiness.statusCode !== 200) throw new Error('PILOT_DEPENDENCIES_NOT_READY');
    await application.app.listen({ host: config.pilot.host, port: config.pilot.port });
  } catch (error) {
    await application.app.close();
    throw error;
  }
  process.stderr.write(`${JSON.stringify({
    event: 'pilot-server-listening',
    host: config.pilot.host,
    port: config.pilot.port,
    mode: config.nodeEnv,
    database: 'ready',
    objectStorage: config.nodeEnv === 'production' ? 's3' : 'filesystem',
  })}\n`);
  return application;
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (entryPath === fileURLToPath(import.meta.url)) {
  runPilotServer().then(({ app }) => {
    const close = async () => {
      await app.close();
      process.exitCode = 0;
    };
    process.once('SIGINT', () => { void close(); });
    process.once('SIGTERM', () => { void close(); });
  }).catch(() => {
    process.stderr.write('Pilot server failed to start. Check the documented configuration and dependencies.\n');
    process.exitCode = 1;
  });
}
