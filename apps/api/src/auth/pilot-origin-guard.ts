import type { FastifyRequest } from 'fastify';

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function requirePilotOrigin(publicOrigin: string) {
  return async (request: FastifyRequest): Promise<void> => {
    const pathname = request.url.split('?', 1)[0];
    if (
      STATE_CHANGING_METHODS.has(request.method)
      && (pathname === '/api' || pathname?.startsWith('/api/') === true)
      && request.headers.origin !== publicOrigin
    ) throw new Error('FORBIDDEN');
  };
}
