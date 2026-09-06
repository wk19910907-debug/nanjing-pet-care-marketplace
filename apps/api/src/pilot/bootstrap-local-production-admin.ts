import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { InitialAdminInput, StaffCredentialService } from '../auth/staff-credential-service.js';

const ADMIN_PASSWORD_MINIMUM_LENGTH = 12;
const ADMIN_PASSWORD_MAXIMUM_LENGTH = 128;
const ADMIN_USERNAME = 'admin';
const ADMIN_DISPLAY_NAME = '系统管理员';

type BootstrapService = Pick<StaffCredentialService, 'bootstrapInitialAdmin'> & {
  disconnect: () => Promise<void>;
};

type SecretFileStat = {
  isFile: () => boolean;
  mode: number;
};

export type LocalProductionAdminBootstrapDependencies = {
  stat: (filePath: string) => Promise<SecretFileStat>;
  readFile: (filePath: string) => Promise<string>;
  createService: (environment: Record<string, string | undefined>) => Promise<BootstrapService>;
  platform: NodeJS.Platform;
  stdout: (value: string) => void;
};

type BootstrapCommandResult = { status: 'ADMIN_INITIALIZED' };

const productionDependencies: LocalProductionAdminBootstrapDependencies = {
  stat,
  readFile: (filePath) => readFile(filePath, 'utf8'),
  createService: createServiceFromEnvironment,
  platform: process.platform,
  stdout: (value) => { process.stdout.write(value); },
};

export function parseBootstrapLocalProductionAdminArgs(args: string[]): { passwordFile: string } {
  if (args.length !== 2 || args[0] !== '--password-file' || !args[1] || !path.isAbsolute(args[1])) {
    throw new Error('LOCAL_PRODUCTION_ADMIN_ARGS_INVALID');
  }
  return { passwordFile: args[1] };
}

function removeOneFinalNewline(password: string): string {
  return password.replace(/\r?\n$/, '');
}

function assertPasswordPolicy(password: string): void {
  if (password.length < ADMIN_PASSWORD_MINIMUM_LENGTH || password.length > ADMIN_PASSWORD_MAXIMUM_LENGTH) {
    throw new Error('PASSWORD_INVALID');
  }
}

async function assertRegularRestrictiveFile(
  passwordFile: string,
  dependencies: LocalProductionAdminBootstrapDependencies,
): Promise<void> {
  const file = await dependencies.stat(passwordFile);
  if (!file.isFile()) throw new Error('ADMIN_PASSWORD_FILE_INVALID');
  if (dependencies.platform !== 'win32' && (file.mode & 0o077) !== 0) {
    throw new Error('ADMIN_PASSWORD_FILE_PERMISSIONS_INVALID');
  }
}

export async function runBootstrapLocalProductionAdminCommand(
  args: string[] = process.argv.slice(2),
  environment: Record<string, string | undefined> = process.env,
  dependencies: LocalProductionAdminBootstrapDependencies = productionDependencies,
): Promise<BootstrapCommandResult> {
  if (environment.LOCAL_PRODUCTION_REHEARSAL !== 'enabled') {
    throw new Error('LOCAL_PRODUCTION_REHEARSAL_REQUIRED');
  }
  const { passwordFile } = parseBootstrapLocalProductionAdminArgs(args);
  await assertRegularRestrictiveFile(passwordFile, dependencies);
  const password = removeOneFinalNewline(await dependencies.readFile(passwordFile));
  assertPasswordPolicy(password);
  const service = await dependencies.createService(environment);
  try {
    await service.bootstrapInitialAdmin({
      username: ADMIN_USERNAME,
      displayName: ADMIN_DISPLAY_NAME,
      temporaryPassword: password,
    });
    const result: BootstrapCommandResult = { status: 'ADMIN_INITIALIZED' };
    dependencies.stdout(`${result.status}\n`);
    return result;
  } finally {
    await service.disconnect();
  }
}

async function createServiceFromEnvironment(
  environment: Record<string, string | undefined>,
): Promise<BootstrapService> {
  const [
    { PrismaAuditRepository },
    { PilotSessionService },
    { StaffCredentialService },
    { createDb },
  ] = await Promise.all([
    import('../audit/audit-repository.js'),
    import('../auth/pilot-session-service.js'),
    import('../auth/staff-credential-service.js'),
    import('../db.js'),
  ]);
  const encodedPepper = environment.PILOT_AUTH_PEPPER;
  if (!encodedPepper || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encodedPepper)) {
    throw new Error('PILOT_AUTH_PEPPER_INVALID');
  }
  const pepper = Buffer.from(encodedPepper, 'base64');
  if (pepper.byteLength < 32 || pepper.toString('base64') !== encodedPepper) {
    throw new Error('PILOT_AUTH_PEPPER_INVALID');
  }
  const prisma = createDb(environment.DATABASE_URL);
  const sessions = new PilotSessionService(prisma, {
    pepper,
    inviteHours: 24,
    sessionDays: 7,
  });
  const service = new StaffCredentialService(prisma, sessions, new PrismaAuditRepository(prisma), {
    usernamePepper: pepper,
  });
  return {
    bootstrapInitialAdmin: (input: InitialAdminInput) => service.bootstrapInitialAdmin(input),
    disconnect: () => prisma.$disconnect(),
  };
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (entryPath === fileURLToPath(import.meta.url)) {
  runBootstrapLocalProductionAdminCommand().catch(() => {
    process.stderr.write('Local production administrator initialization failed. Check the documented configuration and secret file.\n');
    process.exitCode = 1;
  });
}
