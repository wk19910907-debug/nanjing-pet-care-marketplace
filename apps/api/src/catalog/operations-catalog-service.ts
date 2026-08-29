import {
  OperationsCatalogUpdateSchema,
  type AdminOperationsCatalog,
  type OperationsCatalogUpdate,
  type PublicOperationsCatalog,
} from '@pet/contracts';
import type { ActorContext } from '../auth/auth-service.js';
import { authorizeRole } from '../auth/authorize.js';

export interface OperationsCatalogRepository {
  get(): Promise<AdminOperationsCatalog>;
  compareAndSwap(
    input: OperationsCatalogUpdate,
    updatedByUserId: string,
  ): Promise<AdminOperationsCatalog | null>;
}

function toPublic(catalog: AdminOperationsCatalog): PublicOperationsCatalog {
  return {
    services: catalog.services,
    openDistricts: catalog.openDistricts,
    announcement: catalog.announcement,
  };
}

export class OperationsCatalogService {
  public constructor(private readonly repository: OperationsCatalogRepository) {}

  public async getPublic(): Promise<PublicOperationsCatalog> {
    return toPublic(await this.repository.get());
  }

  public async getAdmin(actor: ActorContext): Promise<AdminOperationsCatalog> {
    authorizeRole(actor, ['ADMIN']);
    return this.repository.get();
  }

  public async update(actor: ActorContext, input: unknown): Promise<AdminOperationsCatalog> {
    authorizeRole(actor, ['ADMIN']);
    const parsed = OperationsCatalogUpdateSchema.parse(input);
    const updated = await this.repository.compareAndSwap(parsed, actor.userId);
    if (!updated) throw new Error('OPERATIONS_CATALOG_CONFLICT');
    return updated;
  }
}
