import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuthService } from '../auth/auth-service.js';
import type { FulfillmentService } from './fulfillment-service.js';
import {
  toCheckInResponse,
  toEvidenceResponse,
  toReportResponse,
  toUploadResponse,
} from './response-dtos.js';

const JsonObjectSchema = z.record(z.string(), z.unknown());
const MediaSchema = z.object({
  mimeType: z.string().min(1).max(100),
  sizeBytes: z.int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
});

export type FulfillmentRoutesDependencies = {
  auth: AuthService;
  fulfillment: FulfillmentService;
  clientTimestampsEnabled?: boolean;
};

export async function registerFulfillmentRoutes(app: FastifyInstance, deps: FulfillmentRoutesDependencies) {
  const actor = (request: FastifyRequest) => deps.auth.authenticate(request.headers.authorization);

  if (deps.clientTimestampsEnabled !== false) {
    app.post<{ Params: { orderId: string } }>('/v1/orders/:orderId/check-in', async (request, reply) => {
      const input = z.object({
        checkedInAt: z.iso.datetime({ offset: true }), beforeState: JsonObjectSchema,
      }).parse(request.body);
      const result = await deps.fulfillment.checkIn(
        await actor(request), request.params.orderId, new Date(input.checkedInAt), input.beforeState,
      );
      return reply.code(201).send(toCheckInResponse(result));
    });
  }

  app.post<{ Params: { orderId: string } }>('/v1/orders/:orderId/evidence/uploads', async (request) =>
    toUploadResponse(await deps.fulfillment.issueUpload(
      await actor(request), request.params.orderId, MediaSchema.parse(request.body),
    )));

  app.post<{ Params: { orderId: string } }>('/v1/orders/:orderId/evidence', async (request, reply) => {
    const input = MediaSchema.extend({
      objectKey: z.string().min(1).max(500), capturedAt: z.iso.datetime({ offset: true }),
    }).parse(request.body);
    const result = await deps.fulfillment.attachEvidence(await actor(request), request.params.orderId, {
      ...input, capturedAt: new Date(input.capturedAt),
    });
    return reply.code(201).send(toEvidenceResponse(result));
  });

  if (deps.clientTimestampsEnabled !== false) {
    app.post<{ Params: { orderId: string } }>('/v1/orders/:orderId/report', async (request) => {
      const input = z.object({
        checklist: JsonObjectSchema, afterState: JsonObjectSchema,
        notes: z.string().max(1000), checkedOutAt: z.iso.datetime({ offset: true }),
      }).parse(request.body);
      return toReportResponse(await deps.fulfillment.submitReport(
        await actor(request), request.params.orderId,
        { ...input, checkedOutAt: new Date(input.checkedOutAt) },
      ));
    });
  }

  app.get<{ Params: { evidenceId: string } }>('/v1/evidence/:evidenceId/read-url', async (request) => {
    const result = await deps.fulfillment.getEvidenceReadUrl(
      await actor(request), request.params.evidenceId,
    );
    return { url: result.url, expiresInSeconds: result.expiresInSeconds };
  });
}
