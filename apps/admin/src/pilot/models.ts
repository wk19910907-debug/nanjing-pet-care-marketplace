export type PilotRole = 'OWNER' | 'PROVIDER' | 'ADMIN';
export type PilotInviteRole = Extract<PilotRole, 'OWNER' | 'PROVIDER'>;
export type LocalPilotRole = Extract<PilotRole, 'OWNER' | 'PROVIDER' | 'ADMIN'>;
export type {
  AdminOperationsCatalog,
  NanjingDistrictCode,
  OperationsCatalogUpdate,
  PublicOperationsCatalog,
} from '@pet/contracts';

export type PilotSession = {
  userId: string;
  role: PilotRole;
  displayName: string | null;
  expiresAt: string;
};

export type PilotSessionCreated = {
  expiresAt: string;
};

/** A recovery secret is returned only by the issue/rotate calls; callers must not persist it. */
export type OwnerRecoveryCredential = {
  token: string;
  recoveryPath: string;
};

export type StaffSessionCreated = PilotSessionCreated & { mustChangePassword: boolean };
export type StaffAccount = {
  userId: string;
  username: string;
  displayName: string;
  role: 'PROVIDER';
  mustChangePassword: boolean;
  disabledAt: string | null;
  createdAt: string;
};
export type CreateStaffAccount = {
  username: string;
  displayName: string;
  temporaryPassword: string;
};
export type UpdateStaffAccount = { disabled: boolean };
export type OrderMessage = {
  id: string;
  orderId: string;
  authorRole: 'OWNER' | 'ADMIN';
  body: string;
  createdAt: string;
};
export type OrderMessagePage = { items: OrderMessage[]; nextCursor?: string };

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

export type PetSpecies = 'CAT' | 'DOG';
export type ServiceType = 'CAT_FEEDING' | 'DOG_WALKING';
export type OrderStatus =
  | 'PENDING_PAYMENT'
  | 'PENDING_DISPATCH'
  | 'PENDING_SERVICE'
  | 'IN_SERVICE'
  | 'PENDING_CONFIRMATION'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'REFUND_PENDING'
  | 'REFUNDED'
  | 'DISPUTED'
  | 'DISPATCH_FAILED'
  | 'EXPIRED';

export type OwnerPet = {
  id: string;
  name: string;
  species: PetSpecies;
  sensitiveNotes: string;
};

export type OwnerAddress = {
  id: string;
  city: '南京市';
  district: string;
  serviceZone: string;
};

export type CreateOwnerPet = Pick<OwnerPet, 'name' | 'species' | 'sensitiveNotes'>;
export type CreateOwnerAddress = Omit<OwnerAddress, 'id'> & {
  latitude: number;
  longitude: number;
  detail: string;
  accessInstructions: '';
};

export type QuoteRequest = {
  serviceType: ServiceType;
  petIds: string[];
  addressId: string;
  startsAt: string;
  durationMinutes: number;
};

export type QuoteBreakdown = {
  baseFen: number;
  extraPetFen: number;
  durationFen: number;
  distanceFen: number;
  holidayFen: number;
  totalFen: number;
  currency: 'CNY';
};

export type CreateOwnerOrder = QuoteRequest & { notes: string };
export type OwnerOrderCreated = {
  id: string;
  status: OrderStatus;
  totalFen: number;
  currency: 'CNY';
};
export type OwnerConfirmation = { orderId: string; status: 'COMPLETED'; confirmedAt: string };
export type EvidenceRead = { url: string; expiresInSeconds: number };

export type PilotChecklist = Record<string, string | number | boolean | null>;
export type ReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED' | 'CANCELLED';

export type OwnerOrder = {
  id: string;
  serviceType: ServiceType;
  status: OrderStatus;
  startsAt: string;
  durationMinutes: number;
  totalFen: number;
  currency: 'CNY';
  city: string;
  district: string;
  serviceZone: string;
  petNames?: string[];
  providerDisplayName?: string;
  notes?: string;
  report?: {
    notes: string;
    submittedAt: string;
    checklist: PilotChecklist;
  };
  evidence?: Array<{ id: string }>;
};

export type AdminOrder = OwnerOrder & { ownerDisplayName?: string };

export type ProviderInvitation = {
  id: string;
  serviceType: ServiceType;
  startsAt: string;
  durationMinutes: number;
  city: string;
  district: string;
  serviceZone: string;
  invitation: { id: string; status: InvitationStatus; expiresAt: string };
};

export type ProviderAssignedOrder = Omit<OwnerOrder, 'providerDisplayName' | 'notes'> & {
  ownerDisplayName?: string;
  invitation?: { id: string; status: InvitationStatus; expiresAt: string };
  evidence?: Array<{ id: string }>;
};

export type ProviderOrder = ProviderInvitation | ProviderAssignedOrder;

export type ProviderReviewQueueItem = {
  id: string;
  displayName: string;
  reviewStatus: ReviewStatus;
  serviceTypes: ServiceType[];
  catExperienceMonths: number;
  dogExperienceMonths: number;
  serviceZone: string;
  radiusKm: number;
  createdAt: string;
};

export type ProviderApplicationInput = Omit<
  ProviderReviewQueueItem,
  'id' | 'displayName' | 'reviewStatus' | 'createdAt'
> & { latitude: number; longitude: number };

export type ProviderAvailabilityInput = { startsAt: string; endsAt: string };
export type AssignedAddress = {
  city: '南京市'; district: string; serviceZone: string; detail: string;
};
export type EvidenceMedia = { mimeType: string; sizeBytes: number; sha256: string };
export type EvidenceUpload = {
  objectKey: string; uploadUrl: string; expiresInSeconds: number;
  uploadHeaders?: { 'x-amz-checksum-sha256': string };
};
export type AttachEvidenceInput = EvidenceMedia & { objectKey: string; capturedAt: string };
export type SubmitReportInput = {
  checklist: PilotChecklist; afterState: PilotChecklist; notes: string;
};
