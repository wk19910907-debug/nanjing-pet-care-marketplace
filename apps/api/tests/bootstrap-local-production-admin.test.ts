import { describe, expect, it } from 'vitest';
import {
  parseBootstrapLocalProductionAdminArgs,
  runBootstrapLocalProductionAdminCommand,
  type LocalProductionAdminBootstrapDependencies,
} from '../src/pilot/bootstrap-local-production-admin.js';

const password = 'Bootstrap-password-2026';

function dependencies(overrides: Partial<LocalProductionAdminBootstrapDependencies> = {}) {
  const calls: Array<{ username: string; displayName: string; temporaryPassword: string }> = [];
  const output: string[] = [];
  const base: LocalProductionAdminBootstrapDependencies = {
    stat: async () => ({ isFile: () => true, mode: 0o100600 }),
    readFile: async () => `${password}\n`,
    createService: async () => ({
      bootstrapInitialAdmin: async (input) => {
        calls.push(input);
        return { userId: 'admin-id', username: input.username };
      },
      disconnect: async () => undefined,
    }),
    platform: 'linux',
    stdout: (value) => output.push(value),
  };
  return { dependencies: { ...base, ...overrides }, calls, output };
}

const environment = {
  LOCAL_PRODUCTION_REHEARSAL: 'enabled',
  DATABASE_URL: 'postgresql://petcare:password@database/petcare',
  PILOT_AUTH_PEPPER: Buffer.alloc(32, 1).toString('base64'),
};

describe('bootstrap local production admin command', () => {
  it('refuses invocation unless the explicit local-production rehearsal gate is enabled', async () => {
    const fixture = dependencies();

    await expect(runBootstrapLocalProductionAdminCommand(
      ['--password-file', '/run/secrets/admin-password'],
      { ...environment, LOCAL_PRODUCTION_REHEARSAL: undefined },
      fixture.dependencies,
    )).rejects.toThrow('LOCAL_PRODUCTION_REHEARSAL_REQUIRED');
    expect(fixture.calls).toEqual([]);
  });

  it('requires the supplied path to be a restrictive regular file before reading it', async () => {
    const notAFile = dependencies({ stat: async () => ({ isFile: () => false, mode: 0o100600 }) });
    await expect(runBootstrapLocalProductionAdminCommand(
      ['--password-file', '/run/secrets/admin-password'], environment, notAFile.dependencies,
    )).rejects.toThrow('ADMIN_PASSWORD_FILE_INVALID');

    const permissive = dependencies({ stat: async () => ({ isFile: () => true, mode: 0o100644 }) });
    await expect(runBootstrapLocalProductionAdminCommand(
      ['--password-file', '/run/secrets/admin-password'], environment, permissive.dependencies,
    )).rejects.toThrow('ADMIN_PASSWORD_FILE_PERMISSIONS_INVALID');
  });

  it('reads only the explicit password file, removes one final newline, and creates the fixed initial admin', async () => {
    const fixture = dependencies();

    const result = await runBootstrapLocalProductionAdminCommand(
      ['--password-file', '/run/secrets/admin-password'], environment, fixture.dependencies,
    );

    expect(fixture.calls).toEqual([{
      username: 'admin', displayName: '系统管理员', temporaryPassword: password,
    }]);
    expect(result).toEqual({ status: 'ADMIN_INITIALIZED' });
    expect(JSON.stringify({ result, output: fixture.output })).not.toContain(password);
    expect(fixture.output).toEqual(['ADMIN_INITIALIZED\n']);
  });

  it('rejects a secret that does not meet the administrator password policy before database access', async () => {
    const fixture = dependencies({ readFile: async () => 'too-short\n' });

    await expect(runBootstrapLocalProductionAdminCommand(
      ['--password-file', '/run/secrets/admin-password'], environment, fixture.dependencies,
    )).rejects.toThrow('PASSWORD_INVALID');
    expect(fixture.calls).toEqual([]);
  });

  it('is idempotent only through the same fixed administrator credential service call', async () => {
    const fixture = dependencies();
    const args = ['--password-file', '/run/secrets/admin-password'];

    await expect(runBootstrapLocalProductionAdminCommand(args, environment, fixture.dependencies))
      .resolves.toEqual({ status: 'ADMIN_INITIALIZED' });
    await expect(runBootstrapLocalProductionAdminCommand(args, environment, fixture.dependencies))
      .resolves.toEqual({ status: 'ADMIN_INITIALIZED' });
    expect(fixture.calls).toEqual([
      { username: 'admin', displayName: '系统管理员', temporaryPassword: password },
      { username: 'admin', displayName: '系统管理员', temporaryPassword: password },
    ]);
  });

  it('rejects all arbitrary username and password command-line arguments', () => {
    for (const args of [
      [], ['--username', 'other'], ['--password', password], ['--password-file', '/run/secrets/admin-password', '--username', 'other'],
    ]) {
      expect(() => parseBootstrapLocalProductionAdminArgs(args)).toThrow('LOCAL_PRODUCTION_ADMIN_ARGS_INVALID');
    }
  });
});
