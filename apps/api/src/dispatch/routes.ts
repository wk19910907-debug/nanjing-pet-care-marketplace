import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuthService } from '../auth/auth-service.js';
import { authorizeRole } from '../auth/authorize.js';
import type { DispatchService } from './dispatch-service.js';
import type { ProviderService } from './provider-service.js';
import { assertPilotLocation } from '../pilot/pilot-locations.js';

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

function applicationResponse(record: { id: string; reviewStatus: string }) {
  return { id: record.id, reviewStatus: record.reviewStatus };
}

function availabilityResponse(record: { id: string; startsAt: Date; endsAt: Date }) {
  return {
    id: record.id, startsAt: record.startsAt.toISOString(), endsAt: record.endsAt.toISOString(),
  };
}

function invitationResponse(record: { id: string; status: string; expiresAt: Date }) {
  return { id: record.id, status: record.status, expiresAt: record.expiresAt.toISOString() };
}

function acceptedOrderResponse(record: { id: string; status: string }) {
  return { id: record.id, status: record.status };
}

export async function registerDispatchRoutes(app: FastifyInstance, deps: DispatchRoutesDependencies) {
  const actor = (request: FastifyRequest) => deps.auth.authenticate(request.headers.authorization);

  app.post('/v1/providers/applications', async (request, reply) => {
    const input = ApplicationSchema.parse(request.body);
    if (new Set(input.serviceTypes).size !== input.serviceTypes.length) throw new Error('VALIDATION_ERROR');
    assertPilotLocation(input);
    const result = await deps.providers.apply(await actor(request), input);
    return reply.code(201).send(applicationResponse(result));
  });

  app.post('/v1/providers/availability', async (request, reply) => {
    const input = AvailabilitySchema.parse(request.body);
    const result = await deps.providers.setAvailability(await actor(request), {
      startsAt: new Date(input.startsAt), endsAt: new Date(input.endsAt),
    });
    return reply.code(201).send(availabilityResponse(result));
  });

  app.post<{ Params: { profileId: string } }>('/v1/providers/:profileId/review', async (request) => {
    const input = ReviewSchema.parse(request.body);
    return applicationResponse(
      await deps.providers.review(await actor(request), request.params.profileId, input.status),
    );
  });

  app.post<{ Params: { orderId: string } }>('/v1/dispatch/:orderId/start', async (request) => {
    const current = await actor(request);
    authorizeRole(current, ['DISPATCHER', 'ADMIN']);
    return (await deps.dispatch.start(request.params.orderId, new Date())).map(invitationResponse);
  });

  app.post<{ Params: { orderId: string } }>('/v1/dispatch/:orderId/expire', async (request) => {
    const current = await actor(request);
    authorizeRole(current, ['DISPATCHER', 'ADMIN']);
    return (await deps.dispatch.expireWave(request.params.orderId, new Date())).map(invitationResponse);
  });

  app.post<{ Params: { invitationId: string } }>('/v1/invitations/:invitationId/accept', async (request) => {
    const current = await actor(request);
    const profile = await deps.providers.getProfile(current);
    return acceptedOrderResponse(
      await deps.dispatch.acceptInvitation(request.params.invitationId, profile.id, new Date()),
    );
  });
}
