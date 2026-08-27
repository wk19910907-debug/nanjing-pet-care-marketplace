import type { FastifyInstance } from 'fastify';
import type { LocalPilotObjectStorage } from '../adapters/local-pilot-object-storage.js';

export type LocalUploadRoutesDependencies = {
  storage: Pick<LocalPilotObjectStorage, 'acceptUpload' | 'readObject'>;
  maxUploadBytes: number;
};

const RAW_UPLOAD_TYPES = new Set([
  'application/octet-stream',
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/quicktime',
]);

function tokenFrom(query: unknown): string {
  if (typeof query !== 'object' || query === null || Array.isArray(query)) {
    throw new Error('FORBIDDEN');
  }
  const keys = Object.keys(query);
  const token = (query as Record<string, unknown>).token;
  if (keys.length !== 1 || keys[0] !== 'token' || typeof token !== 'string' || token.length === 0) {
    throw new Error('FORBIDDEN');
  }
  return token;
}

function errorMessage(error: unknown): string | undefined {
  return error instanceof Error ? error.message : undefined;
}

function frameworkCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null
    && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
}

export async function registerLocalUploadRoutes(
  app: FastifyInstance,
  dependencies: LocalUploadRoutesDependencies,
): Promise<void> {
  if (!Number.isSafeInteger(dependencies.maxUploadBytes) || dependencies.maxUploadBytes <= 0) {
    throw new Error('PILOT_EVIDENCE_SIZE_INVALID');
  }

  app.addContentTypeParser(
    [...RAW_UPLOAD_TYPES],
    { parseAs: 'buffer' },
    (_request, body, done) => { done(null, body); },
  );

  app.setErrorHandler((error, _request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const message = errorMessage(error);
    if (message === 'FORBIDDEN') {
      return reply.code(403).send({ code: 'FORBIDDEN' });
    }
    if (message === 'UPLOAD_INVALID') {
      return reply.code(400).send({ code: 'UPLOAD_INVALID' });
    }
    if (message === 'EVIDENCE_QUOTA_EXCEEDED') {
      return reply.code(429).send({ code: 'EVIDENCE_QUOTA_EXCEEDED' });
    }
    if (message === 'EVIDENCE_STORAGE_UNAVAILABLE') {
      return reply.code(503).send({ code: 'SERVICE_UNAVAILABLE' });
    }
    const code = frameworkCode(error);
    if (code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return reply.code(413).send({ code });
    }
    if (code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' || message === 'MEDIA_TYPE_NOT_ALLOWED') {
      return reply.code(415).send({ code: 'FST_ERR_CTP_INVALID_MEDIA_TYPE' });
    }
    return reply.code(503).send({ code: 'SERVICE_UNAVAILABLE' });
  });

  app.put(
    '/api/v1/pilot/local-evidence',
    { bodyLimit: dependencies.maxUploadBytes },
    async (request, reply) => {
      const contentType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
      if (!contentType || !RAW_UPLOAD_TYPES.has(contentType)) {
        throw new Error('MEDIA_TYPE_NOT_ALLOWED');
      }
      if (!Buffer.isBuffer(request.body)) throw new Error('UPLOAD_INVALID');
      await dependencies.storage.acceptUpload(tokenFrom(request.query), request.body);
      return reply.code(204).send();
    },
  );

  app.get('/api/v1/pilot/local-evidence', async (request, reply) => {
    const object = await dependencies.storage.readObject(tokenFrom(request.query));
    return reply
      .header('Content-Type', object.mimeType)
      .header('Cache-Control', 'private, no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .send(object.bytes);
  });
}
