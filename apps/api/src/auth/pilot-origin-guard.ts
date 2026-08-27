import type { FastifyRequest } from 'fastify';

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function requirePilotOrigin(publicOrigin: string) {
  return async (request: FastifyRequest): Promise<void> => {
    if (
      STATE_CHANGING_METHODS.has(request.method)
      && request.url.startsWith('/api/v1/pilot/')
      && request.headers.origin !== publicOrigin
    ) throw new Error('FORBIDDEN');
  };
}
