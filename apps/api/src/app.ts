import Fastify from 'fastify';
import { ZodError } from 'zod';
import { registerOrderRoutes, type OrderRoutesDependencies } from './orders/routes.js';
import { registerPetRoutes, type PetRoutesDependencies } from './pets/routes.js';
import { registerDispatchRoutes, type DispatchRoutesDependencies } from './dispatch/routes.js';
import { registerFulfillmentRoutes, type FulfillmentRoutesDependencies } from './fulfillment/routes.js';
import { registerDisputeRoutes, type DisputeRoutesDependencies } from './disputes/routes.js';

type AppDependencies = PetRoutesDependencies
  & Partial<Omit<OrderRoutesDependencies, 'auth'>>
  & Partial<Omit<DispatchRoutesDependencies, 'auth'>>
  & Partial<Omit<FulfillmentRoutesDependencies, 'auth'>>
  & Partial<Omit<DisputeRoutesDependencies, 'auth'>>;

export function createApp(dependencies: AppDependencies) {
  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ code: 'VALIDATION_ERROR', issues: error.issues });
    }
    if (error instanceof Error && error.message === 'UNAUTHENTICATED') {
      return reply.code(401).send({ code: 'UNAUTHENTICATED' });
    }
    if (error instanceof Error && error.message === 'FORBIDDEN') {
      return reply.code(403).send({ code: 'FORBIDDEN' });
    }
    if (error instanceof Error && error.message === 'VALIDATION_ERROR') {
      return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    }
    if (error instanceof Error && error.message === 'PAYMENT_VERIFICATION_FAILED') {
      return reply.code(400).send({ code: 'PAYMENT_VERIFICATION_FAILED' });
    }
    if (error instanceof Error && ['DISPATCH_NOT_ALLOWED', 'DISPATCH_CONFLICT'].includes(error.message)) {
      return reply.code(409).send({ code: error.message });
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
    return reply.send(error);
  });
  void app.register(registerPetRoutes, dependencies);
  if (dependencies.quotes && dependencies.orders && dependencies.payments) {
    void app.register(registerOrderRoutes, {
      auth: dependencies.auth,
      quotes: dependencies.quotes,
      orders: dependencies.orders,
      payments: dependencies.payments,
    });
  }
  if (dependencies.providers && dependencies.dispatch) {
    void app.register(registerDispatchRoutes, {
      auth: dependencies.auth,
      providers: dependencies.providers,
      dispatch: dependencies.dispatch,
    });
  }
  if (dependencies.fulfillment) {
    void app.register(registerFulfillmentRoutes, {
      auth: dependencies.auth, fulfillment: dependencies.fulfillment,
    });
  }
  if (dependencies.settlements && dependencies.refunds && dependencies.disputes) {
    void app.register(registerDisputeRoutes, {
      auth: dependencies.auth, settlements: dependencies.settlements,
      refunds: dependencies.refunds, disputes: dependencies.disputes,
    });
  }
  return app;
}
