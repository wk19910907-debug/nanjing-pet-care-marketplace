import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaAuditRepository } from '../audit/audit-repository.js';
import { PilotSessionService } from '../auth/pilot-session-service.js';
import { StaffCredentialService, normalizeStaffUsername } from '../auth/staff-credential-service.js';
import { loadConfig } from '../config.js';
import { createDb } from '../db.js';

type CreateStaffIo = {
  input: NodeJS.ReadStream;
  stdout: (value: string) => void;
  stderr: (value: string) => void;
};

export function parseCreateStaffArgs(args: string[]): { username: string } {
  if (args.includes('--password') || args.some((arg) => arg.startsWith('--password='))) {
    throw new Error('PASSWORD_ARG_FORBIDDEN');
  }
  if (args.length !== 2 || args[0] !== '--username' || !args[1]) throw new Error('CREATE_STAFF_ARGS_INVALID');
  return { username: normalizeStaffUsername(args[1]) };
}

function readHiddenPassword(input: NodeJS.ReadStream, output: (value: string) => void, prompt: string): Promise<string> {
  if (!input.isTTY || typeof input.setRawMode !== 'function') throw new Error('STAFF_STDIN_TTY_REQUIRED');
  output(prompt);
  input.setRawMode(true);
  input.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const done = (error?: Error) => {
      input.removeListener('data', onData);
      input.setRawMode(false);
      output('\n');
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk: Buffer | string) => {
      for (const character of Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk) {
        if (character === '\u0003') return done(new Error('STAFF_INPUT_CANCELLED'));
        if (character === '\r' || character === '\n') return done();
        if (character === '\u007f' || character === '\b') {
          if (value.length > 0) {
            value = value.slice(0, -1);
            output('\b \b');
          }
          continue;
        }
        if (character >= ' ') value += character;
      }
    };
    input.on('data', onData);
  });
}

export async function runCreateStaffCommand(
  args: string[] = process.argv.slice(2),
  environment: Record<string, string | undefined> = process.env,
  io: CreateStaffIo = {
    input: process.stdin,
    stdout: (value) => { process.stdout.write(value); },
    stderr: (value) => { process.stderr.write(value); },
  },
): Promise<{ userId: string; username: string }> {
  const { username } = parseCreateStaffArgs(args);
  if (!io.input.isTTY) throw new Error('STAFF_STDIN_TTY_REQUIRED');
  const config = loadConfig(environment);
  if (!config.pilot) throw new Error('PILOT_MODE_REQUIRED');
  const temporaryPassword = await readHiddenPassword(io.input, io.stderr, 'Temporary password: ');
  const confirmedPassword = await readHiddenPassword(io.input, io.stderr, 'Confirm temporary password: ');
  if (temporaryPassword !== confirmedPassword) throw new Error('PASSWORD_CONFIRMATION_MISMATCH');

  const prisma = createDb(config.databaseUrl);
  try {
    const sessions = new PilotSessionService(prisma, {
      pepper: config.pilot.authPepper,
      inviteHours: config.pilot.inviteHours,
      sessionDays: config.pilot.sessionDays,
    });
    const service = new StaffCredentialService(prisma, sessions, new PrismaAuditRepository(prisma), {
      usernamePepper: config.pilot.authPepper,
    });
    const created = await service.bootstrapInitialAdmin({
      username,
      displayName: '系统管理员',
      temporaryPassword,
    });
    io.stdout(`${created.username} ${created.userId}\n`);
    return created;
  } finally {
    await prisma.$disconnect();
  }
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (entryPath === fileURLToPath(import.meta.url)) {
  runCreateStaffCommand().catch(() => {
    process.stderr.write('Staff administrator creation failed. Check the documented configuration and input.\n');
    process.exitCode = 1;
  });
}
