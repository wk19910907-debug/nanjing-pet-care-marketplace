export type PilotRole = 'OWNER' | 'PROVIDER' | 'ADMIN';
export type PilotInviteRole = Extract<PilotRole, 'OWNER' | 'PROVIDER'>;

export type PilotSession = {
  userId: string;
  role: PilotRole;
  displayName: string | null;
  expiresAt: string;
};

export type PilotSessionCreated = {
  expiresAt: string;
};

export type PilotProfile = {
  id: string;
  role: PilotRole;
  displayName: string;
};

export type PilotInvite = {
  id: string;
  role: PilotRole;
  expiresAt: string;
  consumedAt: string | null;
  createdAt: string;
};

export type PilotInviteCreated = Omit<PilotInvite, 'consumedAt'> & {
  role: PilotInviteRole;
  code: string;
};
