import Fastify from 'fastify';
import { ZodError } from 'zod';
import { registerPetRoutes, type PetRoutesDependencies } from './pets/routes.js';

export function createApp(dependencies: PetRoutesDependencies) {
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
    return reply.send(error);
  });
  void app.register(registerPetRoutes, dependencies);
  return app;
}
