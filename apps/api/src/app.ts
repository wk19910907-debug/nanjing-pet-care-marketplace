import Fastify from 'fastify';
import { ZodError } from 'zod';
import { registerOrderRoutes, type OrderRoutesDependencies } from './orders/routes.js';
import { registerPetRoutes, type PetRoutesDependencies } from './pets/routes.js';

type AppDependencies = PetRoutesDependencies & Partial<Omit<OrderRoutesDependencies, 'auth'>>;

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
  return app;
}
