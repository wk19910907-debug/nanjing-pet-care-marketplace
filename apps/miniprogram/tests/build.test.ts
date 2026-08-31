import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { expect, it } from 'vitest';

it('builds importable app and page bundles that run without Node or browser URL globals', async () => {
  const output = mkdtempSync(path.join(tmpdir(), 'pet-mini-build-'));
  try {
    execFileSync(process.execPath, ['scripts/build.mjs', output], { cwd: process.cwd(), timeout: 30_000, windowsHide: true });
    let app: any;
    let pages = 0;
    const context = vm.createContext({
      App: (value: unknown) => { app = value; }, Page: () => { pages += 1; },
      getApp: () => app, console, setTimeout, clearTimeout,
      wx: { getStorageSync: () => undefined, getExtConfigSync: () => ({}),
        getAccountInfoSync: () => ({ miniProgram: { envVersion: 'release' } }) },
    });
    vm.runInContext(readFileSync(path.join(output, 'app.js'), 'utf8'), context);
    expect(typeof app.globalData.chooseEvidence).toBe('function');
    let request: any;
    const development = vm.createContext({ App: (value: unknown) => { app = value; }, console, setTimeout, clearTimeout,
      wx: { getStorageSync: () => 'cached-production-token', getExtConfigSync: () => ({ developmentApiBaseUrl: 'http://127.0.0.1:51800' }),
        getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
        request: (value: any) => { request = value; value.success({ statusCode: 200, data: { userId: 'u', role: 'OWNER', displayName: '小橘', expiresAt: '2099-01-01T00:00:00Z' } }); } } });
    vm.runInContext(readFileSync(path.join(output, 'app.js'), 'utf8'), development);
    await app.globalData.api.getSession();
    expect(request.header.Authorization).toBeUndefined();
    const manifest = JSON.parse(readFileSync(path.join(output, 'app.json'), 'utf8'));
    for (const entry of manifest.pages) {
      vm.runInContext(readFileSync(path.join(output, `${entry}.js`), 'utf8'), context);
      expect(statSync(path.join(output, `${entry}.wxml`)).size).toBeGreaterThan(0);
    }
    expect(pages).toBe(manifest.pages.length);
    const generated = JSON.parse(readFileSync(path.join(output, '.mini-generated.json'), 'utf8'));
    const obsolete = 'pages/home/removed.wxss';
    writeFileSync(path.join(output, obsolete), '/* old generated asset */');
    writeFileSync(path.join(output, '.mini-generated.json'), JSON.stringify([...generated, obsolete]));
    writeFileSync(path.join(output, 'user-note.txt'), 'preserve this unrelated file');
    execFileSync(process.execPath, ['scripts/build.mjs', output], { cwd: process.cwd(), timeout: 30_000, windowsHide: true });
    expect(existsSync(path.join(output, obsolete))).toBe(false);
    expect(existsSync(path.join(output, 'user-note.txt'))).toBe(true);
  } finally {
    if (path.dirname(output) !== path.resolve(tmpdir()) || !path.basename(output).startsWith('pet-mini-build-')) throw new Error('Unsafe test cleanup');
    rmSync(output, { recursive: true });
  }
}, 40_000);
