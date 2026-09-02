import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import type { PrismaClient } from '@prisma/client';
import type { PricingPolicy } from '@pet/domain';
import { LocalPilotObjectStorage } from '../adapters/local-pilot-object-storage.js';
import { PilotManualPaymentGateway } from '../adapters/pilot-manual-payment-gateway.js';
import { S3ObjectStorage, type S3Signer } from '../adapters/s3-object-storage.js';
import { FieldCrypto } from '../adapters/field-crypto.js';
import { createApp } from '../app.js';
import { PrismaAuditRepository } from '../audit/audit-repository.js';
import type { AuthService } from '../auth/auth-service.js';
import { PilotSessionService } from '../auth/pilot-session-service.js';
import { PublicOwnerAccessService } from '../auth/public-owner-access-service.js';
import { StaffCredentialService } from '../auth/staff-credential-service.js';
import { authenticateStaffAction } from '../auth/staff-action-auth.js';
import { WechatLoginGateway } from '../auth/wechat-login-gateway.js';
import { QuoteService } from '../catalog/quote-service.js';
import { PrismaOperationsCatalogRepository } from '../catalog/operations-catalog-repository.js';
import { OperationsCatalogService } from '../catalog/operations-catalog-service.js';
import type { AppConfig } from '../config.js';
import { createDb } from '../db.js';
import { DispatchService, type DispatchAlertSink } from '../dispatch/dispatch-service.js';
import { ProviderService } from '../dispatch/provider-service.js';
import { DisputeService } from '../disputes/dispute-service.js';
import { FulfillmentService } from '../fulfillment/fulfillment-service.js';
import { registerHealthRoutes } from '../health.js';
import { OrderService } from '../orders/order-service.js';
import { PaymentService } from '../payments/payment-service.js';
import { RefundService } from '../payments/refund-service.js';
import { SettlementService } from '../payments/settlement-service.js';
import { AddressService } from '../pets/address-service.js';
import { PetService } from '../pets/pet-service.js';
import { registerLocalUploadRoutes } from './local-upload-routes.js';
import { ManualFeeService } from './manual-fee-service.js';
import { PilotReadModel } from './pilot-read-model.js';
import { assertPilotLocation } from './pilot-locations.js';

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const READ_URL_TTL_SECONDS = 300;
const PILOT_DISTRICTS = new Set(['建邺区', '鼓楼区', '玄武区', '秦淮区']);
const DEFAULT_STATIC_DIR = fileURLToPath(new URL('../../../admin/dist/', import.meta.url));

const PILOT_PRICING: PricingPolicy = {
  baseFen: { CAT_FEEDING: 3200, DOG_WALKING: 3700 },
  includedPets: 1,
  extraPetFen: 700,
  includedMinutes: { CAT_FEEDING: 25, DOG_WALKING: 30 },
  extraDurationBlockMinutes: 20,
  extraDurationBlockFen: 700,
  includedDistanceKm: 5,
  extraDistanceKmFen: 100,
  holidayMultiplierBps: 10_000,
};

export type PilotCompositionOverrides = {
  prisma?: PrismaClient;
  staticDir?: string;
  s3Signer?: S3Signer;
  databaseProbe?: () => Promise<boolean>;
  alerts?: DispatchAlertSink;
  wechatTransport?: typeof fetch;
};

function fieldEncryptionKey(config: AppConfig): string {
  const key = config.fieldEncryptionKey ?? config.production?.fieldEncryptionKey;
  if (!key) throw new Error('PILOT_FIELD_ENCRYPTION_KEY_REQUIRED');
  return key;
}

function isApiPath(url: string): boolean {
  const pathname = url.split('?', 1)[0];
  return pathname === '/api' || pathname?.startsWith('/api/') === true;
}

function isHashedAsset(filePath: string): boolean {
  return /(?:^|[/\\])[^/\\]+-[A-Za-z0-9_-]{8,}\.[^/\\]+$/.test(filePath);
}

export async function createPilotApplication(
  config: AppConfig,
  overrides: PilotCompositionOverrides = {},
) {
  if (!config.pilot) throw new Error('PILOT_MODE_REQUIRED');
  if (config.nodeEnv === 'production' && !config.pilot.sharedIngressRateLimiting) {
    throw new Error('PILOT_SHARED_INGRESS_RATE_LIMITING_REQUIRED');
  }
  const staticDir = path.resolve(overrides.staticDir ?? DEFAULT_STATIC_DIR);
  if (!path.isAbsolute(staticDir)) throw new Error('PILOT_STATIC_DIR_INVALID');
  await access(path.join(staticDir, 'index.html'));

  const fieldCrypto = FieldCrypto.fromBase64(fieldEncryptionKey(config), 1);
  let localStorage: LocalPilotObjectStorage | undefined;
  const storage = config.nodeEnv === 'production'
    ? (() => {
        if (!overrides.s3Signer) throw new Error('PILOT_S3_SIGNER_REQUIRED');
        return new S3ObjectStorage(overrides.s3Signer);
      })()
    : (() => {
        if (!config.pilot.evidenceDir) throw new Error('PILOT_EVIDENCE_DIR_REQUIRED');
        if (!path.isAbsolute(config.pilot.evidenceDir)) {
          throw new Error('PILOT_EVIDENCE_DIR_INVALID');
        }
        localStorage = new LocalPilotObjectStorage({
          rootDir: config.pilot.evidenceDir,
          signingSecret: config.pilot.authPepper,
          maxUploadBytes: MAX_UPLOAD_BYTES,
        });
        return localStorage;
      })();
  if (localStorage) await localStorage.initialize();

  const ownsPrisma = !overrides.prisma;
  const prisma = overrides.prisma ?? createDb(config.databaseUrl);
  try {
    const audit = new PrismaAuditRepository(prisma);
    const operationsCatalog = new OperationsCatalogService(
      new PrismaOperationsCatalogRepository(prisma, audit),
    );
    const sessions = new PilotSessionService(prisma, {
      pepper: config.pilot.authPepper,
      inviteHours: config.pilot.inviteHours,
      sessionDays: config.pilot.sessionDays,
    });
    const onboardedAuth: AuthService = {
      authenticate: async (authorizationHeader) => {
        const actor = await authenticateStaffAction(sessions.authenticate.bind(sessions), authorizationHeader);
        if (actor.displayName === null) throw new Error('ONBOARDING_REQUIRED');
        return actor;
      },
    };
    const publicOwnerAccess = new PublicOwnerAccessService(prisma, sessions, audit, {
      pepper: config.pilot.authPepper,
    });
    const staffCredentials = new StaffCredentialService(prisma, sessions, audit, {
      usernamePepper: config.pilot.authPepper,
    });
    const businessSessions = {
      authenticate: async (authorizationHeader: string | undefined) => {
        return authenticateStaffAction(sessions.authenticate.bind(sessions), authorizationHeader);
      },
      createInvite: sessions.createInvite.bind(sessions),
    };
    const wechatGateway = config.wechatLogin
      ? new WechatLoginGateway(config.wechatLogin, overrides.wechatTransport)
      : undefined;
    const gateway = new PilotManualPaymentGateway();
    const quotes = new QuoteService(
      prisma,
      PILOT_PRICING,
      {
        distanceKm: async ({ district, serviceZone }) => {
          if (!PILOT_DISTRICTS.has(district) || serviceZone !== district) {
            throw new Error('FORBIDDEN');
          }
          return 0;
        },
      },
      { isHoliday: () => false },
      operationsCatalog,
    );
    const orders = new OrderService(prisma, quotes, gateway, audit);
    const payments = new PaymentService(prisma, gateway, audit);
    const providers = new ProviderService(prisma, audit, { assertSupported: assertPilotLocation });
    const dispatch = new DispatchService(
      prisma,
      audit,
      overrides.alerts ?? {
        notify: async ({ orderId, reason }) => {
          process.stderr.write(`${JSON.stringify({ orderId, reason })}\n`);
        },
      },
    );
    const fulfillment = new FulfillmentService(prisma, audit, storage, {
      maxUploadBytes: MAX_UPLOAD_BYTES,
      readUrlTtlSeconds: READ_URL_TTL_SECONDS,
    });
    const settlements = new SettlementService(prisma, audit, {
      commissionBps: 2_000,
      autoConfirmHours: 24,
    });
    const refunds = new RefundService(prisma, gateway, audit, {
      lateCancellationFeeBps: 2_000,
    });
    const disputes = new DisputeService(prisma, gateway, audit);
    const app = createApp({
      auth: onboardedAuth,
      pets: new PetService(prisma, fieldCrypto),
      addresses: new AddressService(prisma, fieldCrypto, audit, {
        assertSupported: (input) => {
          if (input.city !== '南京市'
            || !PILOT_DISTRICTS.has(input.district)
            || input.serviceZone !== input.district
            || input.accessInstructions !== '') {
            throw new Error('VALIDATION_ERROR');
          }
          assertPilotLocation(input);
        },
      }),
      quotes,
      orders,
      payments,
      providers,
      dispatch,
      fulfillment,
      settlements,
      refunds,
      disputes,
      pilot: { config, sessions, publicOwnerAccess, staffCredentials, ...(wechatGateway ? {
        wechatLogin: { login: async (code: string) => sessions.createWechatSession(await wechatGateway.exchange(code)) },
      } : {}) },
      pilotBusiness: {
        fees: new ManualFeeService(prisma, audit),
        read: new PilotReadModel(prisma),
        fulfillment,
        sessions: businessSessions,
      },
      operationsCatalog: { service: operationsCatalog, sessions },
    }, {
      apiPrefix: '/api',
      clientFulfillmentTimestampsEnabled: false,
      paymentWebhookEnabled: false,
    });

    if (localStorage) {
      void app.register(registerLocalUploadRoutes, {
        storage: localStorage,
        maxUploadBytes: MAX_UPLOAD_BYTES,
      });
    }
    registerHealthRoutes(
      app,
      config,
      overrides.databaseProbe ?? (async () => {
        try {
          await prisma.$queryRaw`SELECT 1`;
          return true;
        } catch {
          return false;
        }
      }),
      config.nodeEnv === 'production'
        ? () => overrides.s3Signer!.probe()
        : async () => true,
      config.nodeEnv === 'production'
        ? async () => {
            try {
              return Boolean(await prisma.staffCredential.findFirst({
                where: { disabledAt: null, user: { role: 'ADMIN' } },
                select: { id: true },
              }));
            } catch {
              return false;
            }
          }
        : async () => true,
    );
    app.addHook('onSend', async (request, reply, payload) => {
      const contentType = reply.getHeader('content-type');
      if (typeof contentType === 'string' && contentType.startsWith('text/html')) {
        reply.header('Cache-Control', 'no-store');
      } else if (reply.statusCode === 200 && isHashedAsset(request.url.split('?', 1)[0] ?? '')) {
        reply.header('Cache-Control', 'public, max-age=31536000, immutable');
      }
      return payload;
    });
    void app.register(fastifyStatic, {
      root: staticDir,
      wildcard: false,
      setHeaders(response, filePath) {
        response.setHeader(
          'Cache-Control',
          path.basename(filePath) === 'index.html'
            ? 'no-store'
            : isHashedAsset(filePath)
              ? 'public, max-age=31536000, immutable'
              : 'public, max-age=0, must-revalidate',
        );
      },
    });
    app.setNotFoundHandler(async (request, reply) => {
      if (request.method === 'GET' && !isApiPath(request.url)) {
        return reply
          .header('Cache-Control', 'no-store')
          .type('text/html; charset=utf-8')
          .sendFile('index.html');
      }
      return reply.code(404).send({ code: 'NOT_FOUND' });
    });
    if (ownsPrisma) {
      app.addHook('onClose', async () => {
        await prisma.$disconnect();
      });
    }
    await app.ready();
    return { app, prisma };
  } catch (error) {
    if (ownsPrisma) await prisma.$disconnect();
    throw error;
  }
}
