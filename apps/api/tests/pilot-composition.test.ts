import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/config.js';
import { bootstrapAdminInvite, runBootstrapCommand } from '../src/pilot/bootstrap.js';
import { createPilotApplication } from '../src/pilot/composition.js';
import { runPilotServer } from '../src/server.js';
import { createApiClient } from '../../miniprogram/services/api.js';
import { addressDraft, petDraft, bookingStartsAt } from '../../miniprogram/services/booking-details.js';

const execFileAsync = promisify(execFile);
const databaseName = `petcare_task5_${randomUUID().replaceAll('-', '')}`;
const databaseBaseUrl = process.env.DATABASE_URL
  ?? 'postgresql://petcare:petcare@127.0.0.1:54329/petcare';
const adminUrl = new URL(databaseBaseUrl);
adminUrl.pathname = '/postgres';
const testUrl = new URL(databaseBaseUrl);
testUrl.pathname = `/${databaseName}`;
const adminClient = new PrismaClient({ datasourceUrl: adminUrl.toString() });
const prismaCli = fileURLToPath(new URL('../../../node_modules/prisma/build/index.js', import.meta.url));
const schemaPath = fileURLToPath(new URL('../../../prisma/schema.prisma', import.meta.url));
const tsxCli = fileURLToPath(new URL('../node_modules/tsx/dist/cli.mjs', import.meta.url));
const bootstrapEntryPath = fileURLToPath(new URL('../src/pilot/bootstrap.ts', import.meta.url));
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const rootPackagePath = fileURLToPath(new URL('../../../package.json', import.meta.url));
const apiPackagePath = fileURLToPath(new URL('../package.json', import.meta.url));
const gitignorePath = fileURLToPath(new URL('../../../.gitignore', import.meta.url));

let temporaryRoot: string;
let staticDir: string;
let evidenceDir: string;

function developmentConfig(overrides: Partial<AppConfig['pilot']> = {}): AppConfig {
  return {
    nodeEnv: 'development',
    databaseUrl: testUrl.toString(),
    fieldEncryptionKey: Buffer.alloc(32, 4).toString('base64'),
    pilot: {
      enabled: true,
      host: '127.0.0.1',
      port: 43124,
      authPepper: Buffer.alloc(32, 7),
      sessionDays: 7,
      inviteHours: 24,
      evidenceDir,
      secureCookies: false,
      ...overrides,
    },
  };
}

function productionConfig(diskPath: string): AppConfig {
  return {
    nodeEnv: 'production',
    databaseUrl: testUrl.toString(),
    pilot: {
      enabled: true,
      host: '127.0.0.1',
      port: 43124,
      publicOrigin: 'https://pilot.example.com',
      authPepper: Buffer.alloc(32, 8),
      sessionDays: 7,
      inviteHours: 24,
      evidenceDir: diskPath,
      secureCookies: true,
      sharedIngressRateLimiting: true,
    },
    production: {
      fieldEncryptionKey: Buffer.alloc(32, 5).toString('base64'),
      objectStorage: {
        endpoint: 'https://objects.example.com',
        bucket: 'pilot-evidence',
        accessKeyId: 'access-id',
        secretAccessKey: 'access-secret',
        region: 'auto',
        forcePathStyle: false,
      },
    },
  };
}

beforeAll(async () => {
  await adminClient.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
  await execFileAsync(process.execPath, [prismaCli, 'migrate', 'deploy', '--schema', schemaPath], {
    env: { ...process.env, DATABASE_URL: testUrl.toString() },
  });
  temporaryRoot = await mkdtemp(path.join(tmpdir(), 'petcare-task5-'));
  staticDir = path.join(temporaryRoot, 'dist');
  evidenceDir = path.join(temporaryRoot, 'private-evidence');
  await mkdir(path.join(staticDir, 'assets'), { recursive: true });
  await writeFile(path.join(staticDir, 'index.html'), '<!doctype html><main>Pilot shell</main>');
  await writeFile(path.join(staticDir, 'assets', 'app-deadbeef.js'), 'globalThis.pilot = true;');
}, 60_000);

afterAll(async () => {
  await adminClient.$executeRawUnsafe(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${databaseName}' AND pid <> pg_backend_pid()`,
  );
  await adminClient.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${databaseName}"`);
  await adminClient.$disconnect();
  await rm(temporaryRoot, { recursive: true, force: true });
});

describe('pilot application composition', () => {
  it('runs a first native booking through real profile, quote and order routes without duplicate retries', async () => {
    const config = developmentConfig();
    config.wechatLogin = { appId: 'wx1234567890abcdef', appSecret: 'a'.repeat(32) };
    const application = await createPilotApplication(config, { staticDir,
      wechatTransport: async () => Response.json({ openid: 'native-booking-openid', session_key: 'test-session-key' }),
    });
    let token: string | null = null;
    const api = createApiClient({ baseUrl: 'http://native.test', token: () => token, transport: async (request) => {
      const response = await application.app.inject({ method: request.method,
        url: new URL(request.url).pathname, headers: request.headers,
        ...(request.data === undefined ? {} : { payload: JSON.stringify(request.data),
          headers: { ...request.headers, 'content-type': 'application/json' } }),
      });
      return { statusCode: response.statusCode, data: response.json() };
    } });
    try {
      token = (await api.createWechatSession({ code: 'native-first-code' })).token;
      await api.saveDisplayName('首单宠主');
      const owner = await api.getSession();
      expect(await api.listPets()).toEqual([]);
      expect(await api.listAddresses()).toEqual([]);
      const draft = addressDraft('建邺区', '测试小区1栋101', 'native-address-1');
      const address = await api.createAddress(draft);
      expect(await api.createAddress(draft)).toEqual(address);
      expect(await api.listAddresses()).toEqual([address]);
      expect(JSON.stringify(address)).not.toMatch(/accessInstructions|encrypted|ownerId/);
      for (const service of ['CAT_FEEDING', 'DOG_WALKING'] as const) {
        const petInput = petDraft(service, service === 'CAT_FEEDING' ? '团子' : '小白', '', `native-${service}`);
        const pet = await api.createPet(petInput);
        expect(await api.createPet(petInput)).toEqual(pet);
        const input = { serviceType: service, petIds: [pet.id], addressId: address.id,
          startsAt: bookingStartsAt('2099-09-01', '10:00'), durationMinutes: service === 'CAT_FEEDING' ? 25 : 30 };
        const quote = await api.quote(input);
        expect(quote).toMatchObject({ totalFen: service === 'CAT_FEEDING' ? 3200 : 3700,
          durationFen: 0, distanceFen: 0, holidayFen: 0, currency: 'CNY' });
        const order = await api.createOrder({ ...input, notes: '' }, `native-order-${service}`);
        expect(order).toMatchObject({ id: expect.any(String), totalFen: quote.totalFen, status: 'PENDING_PAYMENT' });
        expect(await api.createOrder({ ...input, notes: '' }, `native-order-${service}`)).toEqual(order);
      }
      expect(await application.prisma.pet.count({ where: { ownerId: owner.userId } })).toBe(2);
      expect(await application.prisma.serviceAddress.count({ where: { ownerId: owner.userId } })).toBe(1);
      expect(await application.prisma.order.count({ where: { ownerId: owner.userId } })).toBe(2);
    } finally { await application.app.close(); }
  });

  it('wires WeChat exchange to persisted owner sessions, nickname onboarding and restart recovery', async () => {
    const config = developmentConfig();
    config.wechatLogin = { appId: 'wx1234567890abcdef', appSecret: 'a'.repeat(32) };
    const consumed = new Set<string>();
    const wechatTransport: typeof fetch = async (input) => {
      const code = new URL(String(input)).searchParams.get('js_code')!;
      if (consumed.has(code)) return Response.json({ errcode: 40163 });
      consumed.add(code);
      return Response.json({ openid: 'composition-wechat-openid', session_key: 'private-session-key' });
    };
    const first = await createPilotApplication(config, { staticDir, wechatTransport });
    let userId: string;
    let token: string;
    try {
      const login = await first.app.inject({ method: 'POST', url: '/api/v1/auth/wechat/session', payload: { code: 'first-code' } });
      expect(login.statusCode).toBe(201);
      token = login.json().token;
      const headers = { authorization: `Bearer ${token}` };
      const session = await first.app.inject({ method: 'GET', url: '/api/v1/pilot/session', headers });
      expect(session.json()).toMatchObject({ role: 'OWNER', displayName: null });
      userId = session.json().userId;
      expect((await first.app.inject({ method: 'GET', url: '/api/v1/pets', headers })).json())
        .toEqual({ code: 'ONBOARDING_REQUIRED' });
      expect((await first.app.inject({ method: 'POST', url: '/api/v1/pilot/me', headers,
        payload: { displayName: '南京宠主' } })).statusCode).toBe(200);
      expect((await first.app.inject({ method: 'GET', url: '/api/v1/pets', headers })).json()).toEqual([]);
      const repeated = await first.app.inject({ method: 'POST', url: '/api/v1/auth/wechat/session', payload: { code: 'first-code' } });
      expect(repeated.statusCode).toBe(401);
      expect(await first.prisma.pilotSession.count({ where: { userId } })).toBe(1);
    } finally { await first.app.close(); }
    const second = await createPilotApplication(config, { staticDir, wechatTransport });
    try {
      const previous = await second.app.inject({ method: 'GET', url: '/api/v1/pilot/session',
        headers: { authorization: `Bearer ${token}` } });
      expect(previous.json()).toMatchObject({ userId, displayName: '南京宠主' });
      const login = await second.app.inject({ method: 'POST', url: '/api/v1/auth/wechat/session', payload: { code: 'second-code' } });
      expect(login.statusCode).toBe(201);
      const session = await second.app.inject({ method: 'GET', url: '/api/v1/pilot/session',
        headers: { authorization: `Bearer ${login.json().token}` } });
      expect(session.json()).toMatchObject({ userId, role: 'OWNER', displayName: '南京宠主' });
      expect(JSON.stringify(session.json())).not.toMatch(/openid|session_key|unionid/);
    } finally { await second.app.close(); }
  });

  it('persists an invitation session and user across application restarts', async () => {
    const config = developmentConfig();
    const first = await createPilotApplication(config, { staticDir });
    const adminInvite = await bootstrapAdminInvite(config, { prisma: first.prisma });
    const adminLogin = await first.app.inject({
      method: 'POST', url: '/api/v1/pilot/sessions', payload: { inviteCode: adminInvite.code },
    });
    const adminCookie = adminLogin.headers['set-cookie']!;
    await first.app.inject({
      method: 'PATCH', url: '/api/v1/pilot/me', headers: { cookie: adminCookie },
      payload: { displayName: '试点运营' },
    });
    const ownerInvite = await first.app.inject({
      method: 'POST', url: '/api/v1/pilot/invites', headers: { cookie: adminCookie },
      payload: { role: 'OWNER' },
    });
    const ownerLogin = await first.app.inject({
      method: 'POST', url: '/api/v1/pilot/sessions',
      payload: { inviteCode: ownerInvite.json().code },
    });
    const ownerCookie = ownerLogin.headers['set-cookie']!;
    const beforeRestart = await first.app.inject({
      method: 'GET', url: '/api/v1/pilot/session', headers: { cookie: ownerCookie },
    });
    await first.app.close();

    const second = await createPilotApplication(config, { staticDir });
    const afterRestart = await second.app.inject({
      method: 'GET', url: '/api/v1/pilot/session', headers: { cookie: ownerCookie },
    });

    expect(adminLogin.statusCode).toBe(201);
    expect(ownerInvite.statusCode).toBe(201);
    expect(ownerLogin.statusCode).toBe(201);
    expect(afterRestart.statusCode).toBe(200);
    expect(afterRestart.json()).toEqual(beforeRestart.json());
    expect(await second.prisma.user.count({ where: { id: afterRestart.json().userId } })).toBe(1);
    await second.app.close();
  });

  it('reports database readiness with provider labels and no configuration secrets', async () => {
    const config = developmentConfig();
    const readyApplication = await createPilotApplication(config, { staticDir });
    const ready = await readyApplication.app.inject({ method: 'GET', url: '/health/ready' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({
      ready: true,
      database: true,
      encryption: true,
      objectStorage: true,
      paymentProvider: 'manual',
      objectStorageProvider: 'filesystem',
      notificationProvider: 'disabled',
    });
    const serialized = ready.body;
    expect(serialized).not.toContain(config.databaseUrl);
    expect(serialized).not.toContain(config.fieldEncryptionKey!);
    expect(serialized).not.toContain(config.pilot!.authPepper.toString('base64'));
    expect(serialized).not.toContain(config.pilot!.evidenceDir!);
    await readyApplication.app.close();

    const unavailableApplication = await createPilotApplication(config, {
      staticDir,
      databaseProbe: async () => false,
    });
    const unavailable = await unavailableApplication.app.inject({
      method: 'GET', url: '/health/ready',
    });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json()).toMatchObject({ ready: false, database: false });
    await unavailableApplication.app.close();
  });

  it('serves built assets and history fallback without swallowing API misses', async () => {
    const application = await createPilotApplication(developmentConfig(), { staticDir });
    const index = await application.app.inject({ method: 'GET', url: '/' });
    const history = await application.app.inject({ method: 'GET', url: '/owner/orders/123' });
    const asset = await application.app.inject({
      method: 'GET', url: '/assets/app-deadbeef.js',
    });
    const apiMiss = await application.app.inject({ method: 'GET', url: '/api/not-a-route' });
    const prefixedBusinessRoute = await application.app.inject({
      method: 'GET', url: '/api/v1/pets',
    });
    const forbiddenPaymentWebhook = await application.app.inject({
      method: 'POST', url: '/api/v1/payments/webhooks/fake', payload: {},
    });

    expect(index.statusCode).toBe(200);
    expect(index.body).toContain('Pilot shell');
    expect(index.headers['cache-control']).toBe('no-store');
    expect(history.statusCode).toBe(200);
    expect(history.body).toBe(index.body);
    expect(history.headers['cache-control']).toBe('no-store');
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(apiMiss.statusCode).toBe(404);
    expect(apiMiss.headers['content-type']).toContain('application/json');
    expect(apiMiss.body).not.toContain('Pilot shell');
    expect(prefixedBusinessRoute.statusCode).toBe(401);
    expect(forbiddenPaymentWebhook.statusCode).toBe(404);
    await application.app.close();
  });

  it('uses the reviewed district allowlist and pilot pricing policy', async () => {
    const config = developmentConfig();
    const application = await createPilotApplication(config, { staticDir });
    const adminInvite = await bootstrapAdminInvite(config, { prisma: application.prisma });
    const adminLogin = await application.app.inject({
      method: 'POST', url: '/api/v1/pilot/sessions',
      payload: { inviteCode: adminInvite.code },
    });
    const adminCookie = adminLogin.headers['set-cookie']!;
    await application.app.inject({
      method: 'PATCH', url: '/api/v1/pilot/me', headers: { cookie: adminCookie },
      payload: { displayName: '定价运营' },
    });
    const ownerInvite = await application.app.inject({
      method: 'POST', url: '/api/v1/pilot/invites', headers: { cookie: adminCookie },
      payload: { role: 'OWNER' },
    });
    const ownerLogin = await application.app.inject({
      method: 'POST', url: '/api/v1/pilot/sessions',
      payload: { inviteCode: ownerInvite.json().code },
    });
    const ownerCookie = ownerLogin.headers['set-cookie']!;
    await application.app.inject({
      method: 'PATCH', url: '/api/v1/pilot/me', headers: { cookie: ownerCookie },
      payload: { displayName: '定价宠主' },
    });
    const cat = await application.app.inject({
      method: 'POST', url: '/api/v1/pets', headers: { cookie: ownerCookie },
      payload: { name: '汤圆', species: 'CAT', sensitiveNotes: '' },
    });
    const dog = await application.app.inject({
      method: 'POST', url: '/api/v1/pets', headers: { cookie: ownerCookie },
      payload: { name: '元宝', species: 'DOG', sensitiveNotes: '' },
    });
    const allowedAddress = await application.app.inject({
      method: 'POST', url: '/api/v1/addresses', headers: { cookie: ownerCookie },
      payload: {
        city: '南京市', district: '建邺区', serviceZone: '建邺区',
        latitude: 32.003, longitude: 118.732, detail: '测试地址', accessInstructions: '',
      },
    });
    const addressCountBeforeInvalidRequests = await application.prisma.serviceAddress.count();
    const unsupportedDistrict = await application.app.inject({
      method: 'POST', url: '/api/v1/addresses', headers: { cookie: ownerCookie },
      payload: {
        city: '南京市', district: '江宁区', serviceZone: '建邺区',
        latitude: 31.953, longitude: 118.839, detail: '测试地址', accessInstructions: '',
      },
    });
    const mismatchedAllowedDistrict = await application.app.inject({
      method: 'POST', url: '/api/v1/addresses', headers: { cookie: ownerCookie },
      payload: {
        city: '南京市', district: '鼓楼区', serviceZone: '建邺区',
        latitude: 32.067, longitude: 118.769, detail: '测试地址', accessInstructions: '',
      },
    });
    const arbitraryCoordinates = await application.app.inject({
      method: 'POST', url: '/api/v1/addresses', headers: { cookie: ownerCookie },
      payload: {
        city: '南京市', district: '建邺区', serviceZone: '建邺区',
        latitude: 32.0031, longitude: 118.732, detail: '测试地址', accessInstructions: '',
      },
    });
    const doorSecret = await application.app.inject({
      method: 'POST', url: '/api/v1/addresses', headers: { cookie: ownerCookie },
      payload: {
        city: '南京市', district: '建邺区', serviceZone: '建邺区',
        latitude: 32.003, longitude: 118.732, detail: '测试地址', accessInstructions: '门锁密码123456',
      },
    });
    const startsAt = '2026-09-15T08:00:00.000+08:00';
    const catQuote = await application.app.inject({
      method: 'POST', url: '/api/v1/quotes', headers: { cookie: ownerCookie },
      payload: {
        serviceType: 'CAT_FEEDING', petIds: [cat.json().id],
        addressId: allowedAddress.json().id, startsAt, durationMinutes: 25,
      },
    });
    const dogQuote = await application.app.inject({
      method: 'POST', url: '/api/v1/quotes', headers: { cookie: ownerCookie },
      payload: {
        serviceType: 'DOG_WALKING', petIds: [dog.json().id],
        addressId: allowedAddress.json().id, startsAt, durationMinutes: 30,
      },
    });
    await application.prisma.serviceAddress.update({
      where: { id: allowedAddress.json().id },
      data: { district: '江宁区', serviceZone: '建邺区' },
    });
    const unsupportedPersistedDistrictQuote = await application.app.inject({
      method: 'POST', url: '/api/v1/quotes', headers: { cookie: ownerCookie },
      payload: {
        serviceType: 'CAT_FEEDING', petIds: [cat.json().id],
        addressId: allowedAddress.json().id, startsAt, durationMinutes: 25,
      },
    });
    await application.prisma.serviceAddress.update({
      where: { id: allowedAddress.json().id },
      data: { district: '鼓楼区', serviceZone: '建邺区' },
    });
    const mismatchedPersistedDistrictQuote = await application.app.inject({
      method: 'POST', url: '/api/v1/quotes', headers: { cookie: ownerCookie },
      payload: {
        serviceType: 'CAT_FEEDING', petIds: [cat.json().id],
        addressId: allowedAddress.json().id, startsAt, durationMinutes: 25,
      },
    });

    expect(unsupportedDistrict.statusCode).toBe(400);
    expect(unsupportedDistrict.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(mismatchedAllowedDistrict.statusCode).toBe(400);
    expect(mismatchedAllowedDistrict.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(arbitraryCoordinates.statusCode).toBe(400);
    expect(doorSecret.statusCode).toBe(400);
    expect(await application.prisma.serviceAddress.count()).toBe(addressCountBeforeInvalidRequests);
    expect(catQuote.statusCode).toBe(200);
    expect(catQuote.json()).toMatchObject({ totalFen: 3200 });
    expect(dogQuote.statusCode).toBe(200);
    expect(dogQuote.json()).toMatchObject({ totalFen: 3700 });
    expect(unsupportedPersistedDistrictQuote.statusCode).toBe(409);
    expect(unsupportedPersistedDistrictQuote.json()).toEqual({ code: 'AREA_NOT_AVAILABLE' });
    expect(mismatchedPersistedDistrictQuote.statusCode).toBe(403);
    await application.app.close();
  });

  it('requires explicit local storage and an encryption key, and never uses disk in production', async () => {
    const noEvidence = developmentConfig();
    delete noEvidence.pilot!.evidenceDir;
    await expect(createPilotApplication(noEvidence, { staticDir }))
      .rejects.toThrow('PILOT_EVIDENCE_DIR_REQUIRED');
    await expect(createPilotApplication(developmentConfig({ evidenceDir: '.pilot-evidence' }), { staticDir }))
      .rejects.toThrow('PILOT_EVIDENCE_DIR_INVALID');
    const noEncryption = developmentConfig();
    delete noEncryption.fieldEncryptionKey;
    await expect(createPilotApplication(noEncryption, { staticDir }))
      .rejects.toThrow('PILOT_FIELD_ENCRYPTION_KEY_REQUIRED');

    const forbiddenDiskRoot = path.join(temporaryRoot, 'production-must-not-create');
    await expect(createPilotApplication(productionConfig(forbiddenDiskRoot), { staticDir }))
      .rejects.toThrow('PILOT_S3_SIGNER_REQUIRED');
    await expect(readFile(forbiddenDiskRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('uses only the injected S3 signer in production and exposes no local upload route', async () => {
    const forbiddenDiskRoot = path.join(temporaryRoot, 'production-disk-unused');
    const application = await createPilotApplication(productionConfig(forbiddenDiskRoot), {
      staticDir,
      s3Signer: {
        probe: async () => true,
        presignPut: async () => 'https://objects.example.com/upload',
        presignGet: async () => 'https://objects.example.com/read',
        head: async () => null,
      },
    });
    const beforeAdmin = await application.app.inject({ method: 'GET', url: '/health/ready' });
    const admin = await application.prisma.user.create({
      data: { role: 'ADMIN', displayName: '就绪管理员' }, select: { id: true },
    });
    await application.prisma.staffCredential.create({
      data: { userId: admin.id, usernameNormalized: 'readiness.admin', passwordHash: 'test-only-hash' },
    });
    const ready = await application.app.inject({ method: 'GET', url: '/health/ready' });
    const localRoute = await application.app.inject({
      method: 'GET', url: '/api/v1/pilot/local-evidence?token=unused',
    });

    expect(beforeAdmin.statusCode).toBe(503);
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toMatchObject({ objectStorage: true, objectStorageProvider: 's3' });
    expect(localRoute.statusCode).toBe(404);
    await expect(readFile(forbiddenDiskRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    await application.prisma.staffCredential.delete({ where: { userId: admin.id } });
    await application.prisma.user.delete({ where: { id: admin.id } });
    await application.app.close();
  });

  it('reports production as unavailable when the S3 dependency probe fails', async () => {
    const application = await createPilotApplication(
      productionConfig(path.join(temporaryRoot, 'unused-unavailable-storage')),
      {
        staticDir,
        s3Signer: {
          presignPut: async () => 'https://objects.example.com/upload',
          presignGet: async () => 'https://objects.example.com/read',
          head: async () => null,
          probe: async () => false,
        },
      },
    );
    const ready = await application.app.inject({ method: 'GET', url: '/health/ready' });
    expect(ready.statusCode).toBe(503);
    expect(ready.json()).toMatchObject({ ready: false, database: true, objectStorage: false });
    await application.app.close();
  });

  it('guards every production write, enforces onboarding, and removes client-timed fulfillment aliases', async () => {
    const config = productionConfig(path.join(temporaryRoot, 'unused-production-disk'));
    const application = await createPilotApplication(config, {
      staticDir,
      s3Signer: {
        probe: async () => true,
        presignPut: async () => 'https://objects.example.com/upload',
        presignGet: async () => 'https://objects.example.com/read',
        head: async () => null,
      },
    });
    const origin = config.pilot!.publicOrigin!;
    const adminInvite = await bootstrapAdminInvite(config, { prisma: application.prisma });
    const adminLogin = await application.app.inject({
      method: 'POST', url: '/api/v1/pilot/sessions', headers: { origin },
      payload: { inviteCode: adminInvite.code },
    });
    const adminCookie = adminLogin.headers['set-cookie']!;
    await application.app.inject({
      method: 'PATCH', url: '/api/v1/pilot/me', headers: { origin, cookie: adminCookie },
      payload: { displayName: '安全运营' },
    });
    const ownerInvite = await application.app.inject({
      method: 'POST', url: '/api/v1/pilot/invites', headers: { origin, cookie: adminCookie },
      payload: { role: 'OWNER' },
    });
    const ownerLogin = await application.app.inject({
      method: 'POST', url: '/api/v1/pilot/sessions', headers: { origin },
      payload: { inviteCode: ownerInvite.json().code },
    });
    const ownerCookie = ownerLogin.headers['set-cookie']!;
    const petPayload = { name: '汤圆', species: 'CAT', sensitiveNotes: '' };
    const beforeOnboarding = await application.app.inject({
      method: 'POST', url: '/api/v1/pets', headers: { origin, cookie: ownerCookie },
      payload: petPayload,
    });
    await application.app.inject({
      method: 'PATCH', url: '/api/v1/pilot/me', headers: { origin, cookie: ownerCookie },
      payload: { displayName: '安全宠主' },
    });
    const missingOrigin = await application.app.inject({
      method: 'POST', url: '/api/v1/pets', headers: { cookie: ownerCookie }, payload: petPayload,
    });
    const wrongOrigin = await application.app.inject({
      method: 'POST', url: '/api/v1/pets',
      headers: { origin: 'https://attacker.example', cookie: ownerCookie }, payload: petPayload,
    });
    const allowed = await application.app.inject({
      method: 'POST', url: '/api/v1/pets', headers: { origin, cookie: ownerCookie },
      payload: petPayload,
    });
    const legacyCheckIn = await application.app.inject({
      method: 'POST', url: '/api/v1/orders/11111111-1111-4111-8111-111111111111/check-in',
      headers: { origin, cookie: ownerCookie },
      payload: { checkedInAt: '2035-01-01T00:00:00.000Z', beforeState: {} },
    });
    const legacyReport = await application.app.inject({
      method: 'POST', url: '/api/v1/orders/11111111-1111-4111-8111-111111111111/report',
      headers: { origin, cookie: ownerCookie },
      payload: { checklist: {}, afterState: {}, notes: '', checkedOutAt: '2035-01-01T00:00:00.000Z' },
    });

    expect(beforeOnboarding.statusCode).toBe(403);
    expect(beforeOnboarding.json()).toEqual({ code: 'ONBOARDING_REQUIRED' });
    expect(missingOrigin.statusCode).toBe(403);
    expect(wrongOrigin.statusCode).toBe(403);
    expect(allowed.statusCode).toBe(201);
    expect(legacyCheckIn.statusCode).toBe(404);
    expect(legacyReport.statusCode).toBe(404);
    await application.app.close();
  });

  it('refuses to listen when its dependency readiness probe fails', async () => {
    const environment = {
      NODE_ENV: 'development',
      DATABASE_URL: testUrl.toString(),
      PILOT_MODE: 'enabled',
      PILOT_PORT: '43126',
      PILOT_AUTH_PEPPER: Buffer.alloc(32, 7).toString('base64'),
      FIELD_ENCRYPTION_KEY_V1: Buffer.alloc(32, 4).toString('base64'),
      PILOT_EVIDENCE_DIR: evidenceDir,
    };
    let listened = false;
    try {
      const application = await runPilotServer(environment, {
        staticDir,
        databaseProbe: async () => false,
      });
      listened = true;
      await application.app.close();
    } catch (error) {
      expect(error).toEqual(new Error('PILOT_DEPENDENCIES_NOT_READY'));
    }
    expect(listened).toBe(false);
  });

  it('listens on the configured loopback address and serves a cookie session', async () => {
    const config = developmentConfig({ port: 43127 });
    const invite = await bootstrapAdminInvite(config);
    const environment = {
      NODE_ENV: 'development',
      DATABASE_URL: config.databaseUrl,
      PILOT_MODE: 'enabled',
      PILOT_HOST: '127.0.0.1',
      PILOT_PORT: '43127',
      PILOT_AUTH_PEPPER: config.pilot!.authPepper.toString('base64'),
      FIELD_ENCRYPTION_KEY_V1: config.fieldEncryptionKey,
      PILOT_EVIDENCE_DIR: evidenceDir,
    };
    const application = await runPilotServer(environment, { staticDir });
    try {
      const ready = await fetch('http://127.0.0.1:43127/health/ready');
      const index = await fetch('http://127.0.0.1:43127/');
      const login = await fetch('http://127.0.0.1:43127/api/v1/pilot/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ inviteCode: invite.code }),
      });
      const cookie = login.headers.get('set-cookie')?.split(';', 1)[0];
      const session = await fetch('http://127.0.0.1:43127/api/v1/pilot/session', {
        headers: { cookie: cookie ?? '' },
      });

      expect(ready.status).toBe(200);
      expect(index.status).toBe(200);
      expect(login.status).toBe(201);
      expect(cookie).toMatch(/^petcare_pilot_session=/);
      expect(session.status).toBe(200);
      expect(await session.json()).toMatchObject({ role: 'ADMIN' });
    } finally {
      await application.app.close();
    }
  });
});

describe('pilot bootstrap and commands', () => {
  it('keeps the advertised pnpm command stdout to one raw credential line', async () => {
    const pepper = Buffer.alloc(32, 12).toString('base64');
    const pnpmCli = process.env.npm_execpath;
    expect(pnpmCli).toBeTruthy();
    const result = await execFileAsync(process.execPath, [pnpmCli!, '--silent', 'pilot:bootstrap'], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        DATABASE_URL: testUrl.toString(),
        PILOT_MODE: 'enabled',
        PILOT_AUTH_PEPPER: pepper,
      },
    });
    const lines = result.stdout.trim().split(/\r?\n/);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(result.stderr).not.toContain(lines[0]!);
    expect(result.stderr).not.toContain(pepper);
  });

  it('executes as a terminal command with exactly one credential line on stdout', async () => {
    const pepper = Buffer.alloc(32, 11).toString('base64');
    const result = await execFileAsync(process.execPath, [tsxCli, bootstrapEntryPath], {
      env: {
        ...process.env,
        NODE_ENV: 'development',
        DATABASE_URL: testUrl.toString(),
        PILOT_MODE: 'enabled',
        PILOT_AUTH_PEPPER: pepper,
      },
    });
    const lines = result.stdout.trim().split(/\r?\n/);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(result.stderr).toContain('one-time pilot administrator invitation');
    expect(result.stderr).not.toContain(lines[0]!);
    expect(result.stderr).not.toContain(pepper);
  });

  it('prints only the one-time raw code to stdout and keeps operations on stderr', async () => {
    const config = developmentConfig();
    const prisma = new PrismaClient({ datasourceUrl: config.databaseUrl });
    const stdout: string[] = [];
    const stderr: string[] = [];
    const environment = {
      NODE_ENV: 'development',
      DATABASE_URL: config.databaseUrl,
      PILOT_MODE: 'enabled',
      PILOT_AUTH_PEPPER: config.pilot!.authPepper.toString('base64'),
    };
    try {
      const result = await runBootstrapCommand(environment, {
        stdout: (value) => { stdout.push(value); },
        stderr: (value) => { stderr.push(value); },
      }, { prisma });
      expect(stdout).toEqual([`${result.code}\n`]);
      expect(stderr.length).toBeGreaterThan(0);
      expect(stderr.join('')).not.toContain(result.code);
      expect(stderr.join('')).not.toContain(environment.PILOT_AUTH_PEPPER);
      expect(await prisma.user.count({ where: { role: 'ADMIN' } })).toBe(1);
    } finally {
      await prisma.$disconnect();
    }
  });

  it('declares the executable pilot workflow and ignores local evidence', async () => {
    const rootPackage = JSON.parse(await readFile(rootPackagePath, 'utf8')) as {
      scripts: Record<string, string>;
    };
    const apiPackage = JSON.parse(await readFile(apiPackagePath, 'utf8')) as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const gitignore = await readFile(gitignorePath, 'utf8');

    expect(rootPackage.scripts).toMatchObject({
      'pilot:build': 'pnpm --filter @pet/admin build --mode pilot',
      'pilot:start': 'pnpm pilot:build && pnpm --filter @pet/api start:pilot',
      'pilot:bootstrap': 'pnpm --silent --filter @pet/api bootstrap:pilot',
    });
    expect(apiPackage.scripts).toMatchObject({
      'start:pilot': 'tsx src/server.ts',
      'bootstrap:pilot': 'tsx src/pilot/bootstrap.ts',
    });
    expect(apiPackage.devDependencies.tsx).toBeTruthy();
    expect(gitignore.split(/\r?\n/)).toContain('.pilot-evidence/');
  });
});
