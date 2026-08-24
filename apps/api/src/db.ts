import { PrismaClient } from '@prisma/client';

export function createDb(databaseUrl?: string): PrismaClient {
  if (!databaseUrl?.startsWith('postgresql://')) {
    throw new Error('DATABASE_URL must be a PostgreSQL URL');
  }
  return new PrismaClient({
    datasourceUrl: databaseUrl,
    ...(process.env.NODE_ENV === 'test' ? { transactionOptions: { timeout: 15_000 } } : {}),
  });
}
