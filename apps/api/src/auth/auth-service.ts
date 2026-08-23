import type { ActorRole } from '@pet/contracts';

export type ActorContext = {
  userId: string;
  role: ActorRole;
};

export interface AuthService {
  authenticate(authorizationHeader: string | undefined): Promise<ActorContext>;
}
