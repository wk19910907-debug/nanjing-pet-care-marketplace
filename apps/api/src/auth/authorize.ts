import type { ActorRole } from '@pet/contracts';
import type { ActorContext } from './auth-service.js';

export function authorizeRole(actor: ActorContext, allowed: readonly ActorRole[]): void {
  if (!allowed.includes(actor.role)) {
    throw new Error('FORBIDDEN');
  }
}

export function authorizeOwner(actor: ActorContext, ownerId: string): void {
  authorizeRole(actor, ['OWNER']);
  if (actor.userId !== ownerId) {
    throw new Error('FORBIDDEN');
  }
}
