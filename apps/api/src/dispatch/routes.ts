import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuthService } from '../auth/auth-service.js';
import { authorizeRole } from '../auth/authorize.js';
import type { DispatchService } from './dispatch-service.js';
import type { ProviderService } from './provider-service.js';

const ApplicationSchema = z.object({
  serviceTypes: z.array(z.enum(['CAT_FEEDING', 'DOG_WALKING'])).min(1).max(2),
  serviceZone: z.string().trim().min(1).max(50),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusKm: z.number().positive().max(30),
  catExperienceMonths: z.int().min(0).max(1200),
  dogExperienceMonths: z.int().min(0).max(1200),
});

const AvailabilitySchema = z.object({
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }),
});

const ReviewSchema = z.object({ status: z.enum(['APPROVED', 'REJECTED', 'SUSPENDED']) });

export type DispatchRoutesDependencies = {
  auth: AuthService;
  providers: ProviderService;
  dispatch: DispatchService;
};

export async function registerDispatchRoutes(app: FastifyInstance, deps: DispatchRoutesDependencies) {
  const actor = (request: FastifyRequest) => deps.auth.authenticate(request.headers.authorization);

  app.post('/v1/providers/applications', async (request, reply) => {
    const result = await deps.providers.apply(await actor(request), ApplicationSchema.parse(request.body));
    return reply.code(201).send(result);
  });

  app.post('/v1/providers/availability', async (request, reply) => {
    const input = AvailabilitySchema.parse(request.body);
    const result = await deps.providers.setAvailability(await actor(request), {
      startsAt: new Date(input.startsAt), endsAt: new Date(input.endsAt),
    });
    return reply.code(201).send(result);
  });

  app.post<{ Params: { profileId: string } }>('/v1/providers/:profileId/review', async (request) => {
    const input = ReviewSchema.parse(request.body);
    return deps.providers.review(await actor(request), request.params.profileId, input.status);
  });

  app.post<{ Params: { orderId: string } }>('/v1/dispatch/:orderId/start', async (request) => {
    const current = await actor(request);
    authorizeRole(current, ['DISPATCHER', 'ADMIN']);
    return deps.dispatch.start(request.params.orderId, new Date());
  });

  app.post<{ Params: { orderId: string } }>('/v1/dispatch/:orderId/expire', async (request) => {
    const current = await actor(request);
    authorizeRole(current, ['DISPATCHER', 'ADMIN']);
    return deps.dispatch.expireWave(request.params.orderId, new Date());
  });

  app.post<{ Params: { invitationId: string } }>('/v1/invitations/:invitationId/accept', async (request) => {
    const current = await actor(request);
    const profile = await deps.providers.getProfile(current);
    return deps.dispatch.acceptInvitation(request.params.invitationId, profile.id, new Date());
  });
}
