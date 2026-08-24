import type { PrismaClient } from '@prisma/client';
import { runClosure } from './run-closure.js';

export async function seedPilot(prisma: PrismaClient) {
  return runClosure(prisma);
}
