import { z } from 'zod';

const EnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().startsWith('postgresql://'),
});

export type AppConfig = {
  nodeEnv: 'development' | 'test' | 'production';
  databaseUrl: string;
};

export function loadConfig(environment: Record<string, string | undefined>): AppConfig {
  const parsed = EnvironmentSchema.parse(environment);
  return {
    nodeEnv: parsed.NODE_ENV,
    databaseUrl: parsed.DATABASE_URL,
  };
}
