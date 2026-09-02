import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ActorContext } from '../auth/auth-service.js';
import type { OperationsCatalogService } from './operations-catalog-service.js';
import { authenticateStaffAction } from '../auth/staff-action-auth.js';

type CatalogSession = ActorContext & { displayName: string | null; mustChangePassword?: boolean };

export type OperationsCatalogRoutesDependencies = {
  service: Pick<OperationsCatalogService, 'getPublic' | 'getAdmin' | 'update'>;
  sessions: {
    authenticate(authorizationHeader: string | undefined): Promise<CatalogSession>;
  };
};

export async function registerOperationsCatalogRoutes(
  app: FastifyInstance,
  dependencies: OperationsCatalogRoutesDependencies,
): Promise<void> {
  const actor = async (request: FastifyRequest) => {
    const session = await authenticateStaffAction(
      dependencies.sessions.authenticate.bind(dependencies.sessions), request.headers.authorization,
    );
    if (session.displayName === null) throw new Error('ONBOARDING_REQUIRED');
    return session;
  };

  app.get('/api/v1/catalog', async () => dependencies.service.getPublic());

  app.get('/api/v1/pilot/admin/catalog', async (request) => (
    dependencies.service.getAdmin(await actor(request))
  ));

  app.put('/api/v1/pilot/admin/catalog', async (request) => (
    dependencies.service.update(await actor(request), request.body)
  ));
}
