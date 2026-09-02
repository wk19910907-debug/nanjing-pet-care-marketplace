import { describe, expect, it } from 'vitest';
import { parseCreateStaffArgs } from '../src/pilot/create-staff.js';

describe('staff:create-admin arguments', () => {
  it('accepts only an explicit username argument', () => {
    expect(parseCreateStaffArgs(['--username', 'ops.admin'])).toEqual({ username: 'ops.admin' });
    expect(() => parseCreateStaffArgs(['--username', 'ops.admin', '--password', 'secret']))
      .toThrow('PASSWORD_ARG_FORBIDDEN');
    expect(() => parseCreateStaffArgs(['--username', 'ops.admin', '--unexpected']))
      .toThrow('CREATE_STAFF_ARGS_INVALID');
  });
});
