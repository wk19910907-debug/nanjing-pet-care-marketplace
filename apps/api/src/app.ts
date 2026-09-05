import Fastify from 'fastify';
import { ZodError } from 'zod';
import { registerOrderRoutes, type OrderRoutesDependencies } from './orders/routes.js';
import { registerPetRoutes, type PetRoutesDependencies } from './pets/routes.js';
import { registerDispatchRoutes, type DispatchRoutesDependencies } from './dispatch/routes.js';
import { registerFulfillmentRoutes, type FulfillmentRoutesDependencies } from './fulfillment/routes.js';
import { registerDisputeRoutes, type DisputeRoutesDependencies } from './disputes/routes.js';
import {
  installPilotCookieBridge,
  registerPilotAuthRoutes,
  type PilotAuthRoutesDependencies,
} from './auth/pilot-routes.js';
import { requirePilotOrigin } from './auth/pilot-origin-guard.js';
import {
  registerProductionAccessRoutes,
  type ProductionAccessRoutesDependencies,
} from './auth/production-access-routes.js';
import { WECHAT_SESSION_PATH } from './auth/wechat-login-routes.js';
import { registerPilotRoutes, type PilotRoutesDependencies } from './pilot/pilot-routes.js';
import {
  registerOperationsCatalogRoutes,
  type OperationsCatalogRoutesDependencies,
} from './catalog/routes.js';

const SAFE_PILOT_FRAMEWORK_ERRORS: ReadonlyMap<string, number> = new Map([
  ['FST_ERR_CTP_INVALID_JSON_BODY', 400],
  ['FST_ERR_CTP_BODY_TOO_LARGE', 413],
  ['FST_ERR_CTP_INVALID_MEDIA_TYPE', 415],
]);

type AppDependencies = PetRoutesDependencies
  & Partial<Omit<OrderRoutesDependencies, 'auth'>>
  & Partial<Omit<DispatchRoutesDependencies, 'auth'>>
  & Partial<Omit<FulfillmentRoutesDependencies, 'auth'>>
  & Partial<Omit<DisputeRoutesDependencies, 'auth'>>
  & {
    pilot?: PilotAuthRoutesDependencies & Partial<ProductionAccessRoutesDependencies>;
    pilotBusiness?: Omit<PilotRoutesDependencies, 'sessions'> & Partial<Pick<PilotRoutesDependencies, 'sessions'>>;
    operationsCatalog?: OperationsCatalogRoutesDependencies;
  };

type AppOptions = {
  apiPrefix?: string;
  clientFulfillmentTimestampsEnabled?: boolean;
  paymentWebhookEnabled?: boolean;
};

export function createApp(dependencies: AppDependencies, options: AppOptions = {}) {
  if ((dependencies.pilotBusiness || dependencies.operationsCatalog) && !dependencies.pilot) {
    throw new Error('PILOT_SECURITY_CONFIGURATION_REQUIRED');
  }
  const trustedProxies = dependencies.pilot?.config.pilot?.trustedProxies;
  const app = Fastify({
    logger: false,
    ...(trustedProxies ? { trustProxy: trustedProxies } : {}),
  });
  app.setErrorHandler((error, request, reply) => {
    if (typeof error === 'object' && error !== null && 'statusCode' in error && error.statusCode === 429) {
      return reply.code(429).send({ code: 'RATE_LIMITED' });
    }
    if (error instanceof ZodError) {
      return reply.code(400).send({ code: 'VALIDATION_ERROR', issues: error.issues });
    }
    if (error instanceof Error && error.message === 'UNAUTHENTICATED') {
      return reply.code(401).send({ code: 'UNAUTHENTICATED' });
    }
    if (error instanceof Error && ['RECOVERY_INVALID', 'STAFF_LOGIN_INVALID'].includes(error.message)) {
      return reply.code(401).send({ code: error.message });
    }
    if (error instanceof Error && error.message === 'RECOVERY_ALREADY_ISSUED') {
      return reply.code(409).send({ code: 'RECOVERY_ALREADY_ISSUED' });
    }
    if (error instanceof Error && error.message === 'RECOVERY_NOT_ISSUED') {
      return reply.code(409).send({ code: 'RECOVERY_NOT_ISSUED' });
    }
    if (error instanceof Error && error.message === 'STAFF_LOGIN_BUSY') {
      return reply.code(429).send({ code: 'STAFF_LOGIN_BUSY' });
    }
    if (error instanceof Error && error.message === 'GUEST_CREATION_RATE_LIMITED') {
      return reply.code(429).send({ code: 'GUEST_CREATION_RATE_LIMITED' });
    }
    if (error instanceof Error && error.message === 'INVITE_INVALID') {
      return reply.code(401).send({ code: 'INVITE_INVALID' });
    }
    if (error instanceof Error && error.message === 'LOGIN_RATE_LIMITED') {
      return reply.code(429).send({ code: 'LOGIN_RATE_LIMITED' });
    }
    if (error instanceof Error && error.message === 'FORBIDDEN') {
      return reply.code(403).send({ code: 'FORBIDDEN' });
    }
    if (error instanceof Error && error.message === 'ONBOARDING_REQUIRED') {
      return reply.code(403).send({ code: 'ONBOARDING_REQUIRED' });
    }
    if (error instanceof Error && error.message === 'PASSWORD_CHANGE_REQUIRED') {
      return reply.code(403).send({ code: 'PASSWORD_CHANGE_REQUIRED' });
    }
    if (error instanceof Error && error.message === 'VALIDATION_ERROR') {
      return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    }
    if (error instanceof Error && error.message === 'DISPLAY_NAME_INVALID') {
      return reply.code(400).send({ code: 'DISPLAY_NAME_INVALID' });
    }
    if (error instanceof Error && error.message === 'PAYMENT_VERIFICATION_FAILED') {
      return reply.code(400).send({ code: 'PAYMENT_VERIFICATION_FAILED' });
    }
    if (error instanceof Error && error.message === 'EVIDENCE_QUOTA_EXCEEDED') {
      return reply.code(429).send({ code: 'EVIDENCE_QUOTA_EXCEEDED' });
    }
    if (error instanceof Error && error.message === 'EVIDENCE_STORAGE_UNAVAILABLE') {
      return reply.code(503).send({ code: 'SERVICE_UNAVAILABLE' });
    }
    if (error instanceof Error && ['DISPATCH_NOT_ALLOWED', 'DISPATCH_CONFLICT'].includes(error.message)) {
      return reply.code(409).send({ code: error.message });
    }
    if (error instanceof Error && ['MANUAL_FEE_CONFLICT'].includes(error.message)) {
      return reply.code(409).send({ code: error.message });
    }
    if (error instanceof Error && error.message === 'PROFILE_REQUEST_CONFLICT') {
      return reply.code(409).send({ code: 'PROFILE_REQUEST_CONFLICT' });
    }
    if (error instanceof Error && error.message === 'OPERATIONS_CATALOG_CONFLICT') {
      return reply.code(409).send({ code: error.message });
    }
    if (error instanceof Error && ['SERVICE_NOT_AVAILABLE', 'AREA_NOT_AVAILABLE'].includes(error.message)) {
      return reply.code(409).send({ code: error.message });
    }
    if (error instanceof Error && error.message === 'ORDER_NOT_FOUND') {
      return reply.code(404).send({ code: 'ORDER_NOT_FOUND' });
    }
    if (error instanceof Error && error.message === 'PROVIDER_NOT_FOUND') {
      return reply.code(404).send({ code: 'PROVIDER_NOT_FOUND' });
    }
    if (error instanceof Error && [
      'FULFILLMENT_NOT_ALLOWED', 'FULFILLMENT_CONFLICT', 'CHECK_IN_OUTSIDE_WINDOW',
    ].includes(error.message)) {
      return reply.code(409).send({ code: error.message });
    }
    if (error instanceof Error && [
      'CHECKLIST_INCOMPLETE', 'EVIDENCE_REQUIRED', 'CHECK_IN_REQUIRED', 'AFTER_STATE_REQUIRED',
      'MEDIA_TYPE_NOT_ALLOWED', 'MEDIA_TOO_LARGE', 'UPLOAD_NOT_VERIFIED',
    ].includes(error.message)) {
      return reply.code(400).send({ code: error.message });
    }
    if (error instanceof Error && [
      'CONFIRMATION_NOT_ALLOWED', 'CANCELLATION_NOT_ALLOWED', 'DISPUTE_NOT_ALLOWED',
    ].includes(error.message)) {
      return reply.code(409).send({ code: error.message });
    }
    if (
      request.url.startsWith('/api/v1/pilot/')
      || request.url.startsWith('/api/v1/public/')
      || request.url.startsWith('/api/v1/staff/')
      || request.url.startsWith('/api/v1/admin/staff-accounts')
      || request.url.split('?', 1)[0] === WECHAT_SESSION_PATH
    ) {
      const frameworkCode = typeof error === 'object' && error !== null
        && 'code' in error && typeof error.code === 'string'
        ? error.code
        : undefined;
      const frameworkStatus = frameworkCode
        ? SAFE_PILOT_FRAMEWORK_ERRORS.get(frameworkCode)
        : undefined;
      if (frameworkCode && frameworkStatus) {
        return reply.code(frameworkStatus).send({ code: frameworkCode });
      }
      return reply.code(503).send({ code: 'SERVICE_UNAVAILABLE' });
    }
    return reply.code(503).send({ code: 'SERVICE_UNAVAILABLE' });
  });
  if (dependencies.pilot) {
    installPilotCookieBridge(app);
    if (dependencies.pilot.config.nodeEnv === 'production') {
      const origin = dependencies.pilot.config.pilot?.publicOrigin;
      if (!origin) throw new Error('PILOT_PUBLIC_ORIGIN_REQUIRED');
      app.addHook('onRequest', requirePilotOrigin(origin));
    }
    void app.register(registerPilotAuthRoutes, dependencies.pilot);
    if (dependencies.pilot.publicOwnerAccess && dependencies.pilot.staffCredentials) {
      void app.register(registerProductionAccessRoutes, dependencies.pilot as ProductionAccessRoutesDependencies);
    }
  }
  if (dependencies.pilotBusiness) {
    void app.register(registerPilotRoutes, {
      ...dependencies.pilotBusiness,
      sessions: dependencies.pilotBusiness.sessions ?? dependencies.pilot!.sessions,
    });
  }
  if (dependencies.operationsCatalog) {
    void app.register(registerOperationsCatalogRoutes, dependencies.operationsCatalog);
  }
  void app.register(async (api) => {
    await api.register(registerPetRoutes, dependencies);
    if (dependencies.quotes && dependencies.orders && dependencies.payments) {
      await api.register(registerOrderRoutes, {
        auth: dependencies.auth,
        quotes: dependencies.quotes,
        orders: dependencies.orders,
        payments: dependencies.payments,
        ...(options.paymentWebhookEnabled === undefined
          ? {}
          : { paymentWebhookEnabled: options.paymentWebhookEnabled }),
      });
    }
    if (dependencies.providers && dependencies.dispatch) {
      await api.register(registerDispatchRoutes, {
        auth: dependencies.auth,
        providers: dependencies.providers,
        dispatch: dependencies.dispatch,
      });
    }
    if (dependencies.fulfillment) {
      await api.register(registerFulfillmentRoutes, {
        auth: dependencies.auth, fulfillment: dependencies.fulfillment,
        ...(options.clientFulfillmentTimestampsEnabled === undefined
          ? {}
          : { clientTimestampsEnabled: options.clientFulfillmentTimestampsEnabled }),
      });
    }
    if (dependencies.settlements && dependencies.refunds && dependencies.disputes) {
      await api.register(registerDisputeRoutes, {
        auth: dependencies.auth, settlements: dependencies.settlements,
        refunds: dependencies.refunds, disputes: dependencies.disputes,
      });
    }
  }, { prefix: options.apiPrefix ?? '' });
  return app;
}
