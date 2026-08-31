import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuthService } from '../auth/auth-service.js';
import type { AddressService } from './address-service.js';
import type { PetService } from './pet-service.js';

const PetInputSchema = z.object({
  name: z.string().trim().min(1).max(50),
  species: z.enum(['CAT', 'DOG']),
  sensitiveNotes: z.string().max(1000),
  clientRequestId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/).optional(),
});

const AddressInputSchema = z.object({
  city: z.literal('南京市'),
  district: z.string().trim().min(1).max(30),
  serviceZone: z.string().trim().min(1).max(50),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  detail: z.string().trim().min(1).max(300),
  accessInstructions: z.string().max(500),
  clientRequestId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/).optional(),
});

export type PetRoutesDependencies = {
  auth: AuthService;
  pets: PetService;
  addresses: AddressService;
};

export async function registerPetRoutes(
  app: FastifyInstance,
  dependencies: PetRoutesDependencies,
): Promise<void> {
  const actor = (request: FastifyRequest) => dependencies.auth.authenticate(request.headers.authorization);

  app.post('/v1/pets', async (request, reply) => {
    const result = await dependencies.pets.create(await actor(request), PetInputSchema.parse(request.body));
    return reply.code(201).send(result);
  });

  app.get('/v1/pets', async (request) => dependencies.pets.list(await actor(request)));

  app.post('/v1/addresses', async (request, reply) => {
    const result = await dependencies.addresses.create(
      await actor(request), AddressInputSchema.parse(request.body),
    );
    return reply.code(201).send(result);
  });

  app.get('/v1/addresses', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    return dependencies.addresses.list(await actor(request));
  });

  app.get<{ Params: { orderId: string } }>(
    '/v1/orders/:orderId/address/candidate',
    async (request) => {
      const current = await actor(request);
      return dependencies.addresses.getCandidateView(request.params.orderId, current.userId);
    },
  );

  app.get<{ Params: { orderId: string } }>(
    '/v1/orders/:orderId/address/assigned',
    async (request) => {
      const current = await actor(request);
      return dependencies.addresses.getAssignedProviderView(
        request.params.orderId, current.userId, new Date(),
      );
    },
  );
}
