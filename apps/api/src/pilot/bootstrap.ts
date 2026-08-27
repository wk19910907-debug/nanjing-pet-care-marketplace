import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PrismaClient } from '@prisma/client';
import { PilotSessionService } from '../auth/pilot-session-service.js';
import { loadConfig, type AppConfig } from '../config.js';
import { createDb } from '../db.js';

type BootstrapOverrides = { prisma?: PrismaClient };

type BootstrapIo = {
  stdout: (value: string) => void;
  stderr: (value: string) => void;
};

export async function bootstrapAdminInvite(
  config: AppConfig,
  overrides: BootstrapOverrides = {},
) {
  if (!config.pilot) throw new Error('PILOT_MODE_REQUIRED');
  const ownsPrisma = !overrides.prisma;
  const prisma = overrides.prisma ?? createDb(config.databaseUrl);
  try {
    const sessions = new PilotSessionService(prisma, {
      pepper: config.pilot.authPepper,
      inviteHours: config.pilot.inviteHours,
      sessionDays: config.pilot.sessionDays,
    });
    return await sessions.bootstrapAdminInvite();
  } finally {
    if (ownsPrisma) await prisma.$disconnect();
  }
}

export async function runBootstrapCommand(
  environment: Record<string, string | undefined> = process.env,
  io: BootstrapIo = {
    stdout: (value) => { process.stdout.write(value); },
    stderr: (value) => { process.stderr.write(value); },
  },
  overrides: BootstrapOverrides = {},
) {
  const config = loadConfig(environment);
  io.stderr('Creating one-time pilot administrator invitation...\n');
  const invitation = await bootstrapAdminInvite(config, overrides);
  io.stdout(`${invitation.code}\n`);
  io.stderr('Pilot administrator invitation created; the code will not be shown again.\n');
  return invitation;
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (entryPath === fileURLToPath(import.meta.url)) {
  runBootstrapCommand().catch(() => {
    process.stderr.write('Pilot bootstrap failed. Check the documented configuration and database availability.\n');
    process.exitCode = 1;
  });
}
