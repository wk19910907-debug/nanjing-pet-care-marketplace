import type { PrismaClient } from '@prisma/client';
import type { FieldCrypto } from '../adapters/field-crypto.js';
import type { AuditRepository } from '../audit/audit-repository.js';
import type { ActorContext } from '../auth/auth-service.js';
import { authorizeRole } from '../auth/authorize.js';

export type CreateAddressInput = {
  city: string;
  district: string;
  serviceZone: string;
  latitude: number;
  longitude: number;
  detail: string;
  accessInstructions: string;
};

export interface AddressLocationPolicy {
  assertSupported(location: Pick<CreateAddressInput, 'district' | 'serviceZone'>): void;
}

function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const toRadians = (degrees: number) => degrees * Math.PI / 180;
  const earthKm = 6371;
  const dLat = toRadians(bLat - aLat);
  const dLon = toRadians(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(aLat)) * Math.cos(toRadians(bLat)) * Math.sin(dLon / 2) ** 2;
  return earthKm * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export class AddressService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly fieldCrypto: FieldCrypto,
    private readonly audit: AuditRepository,
    private readonly locationPolicy?: AddressLocationPolicy,
  ) {}

  public async create(actor: ActorContext, input: CreateAddressInput) {
    authorizeRole(actor, ['OWNER']);
    this.locationPolicy?.assertSupported(input);
    const detail = this.fieldCrypto.encrypt(input.detail);
    const access = input.accessInstructions ? this.fieldCrypto.encrypt(input.accessInstructions) : null;
    return this.prisma.serviceAddress.create({ data: {
      ownerId: actor.userId,
      city: input.city,
      district: input.district,
      serviceZone: input.serviceZone,
      latitude: input.latitude,
      longitude: input.longitude,
      detailCiphertext: new Uint8Array(detail.ciphertext),
      detailNonce: new Uint8Array(detail.nonce),
      detailAuthTag: new Uint8Array(detail.authTag),
      accessCiphertext: access ? new Uint8Array(access.ciphertext) : null,
      accessNonce: access ? new Uint8Array(access.nonce) : null,
      accessAuthTag: access ? new Uint8Array(access.authTag) : null,
      encryptionKeyVersion: detail.keyVersion,
    }});
  }

  public async list(actor: ActorContext) {
    authorizeRole(actor, ['OWNER']);
    return this.prisma.serviceAddress.findMany({
      where: { ownerId: actor.userId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, city: true, district: true, serviceZone: true },
    });
  }

  public async getCandidateView(orderId: string, providerUserId: string) {
    const invitation = await this.prisma.dispatchInvitation.findFirst({
      where: {
        orderId,
        provider: { userId: providerUserId },
        status: 'PENDING',
        expiresAt: { gt: new Date() },
      },
      include: { order: { include: { address: true } }, provider: true },
    });
    if (!invitation) {
      throw new Error('FORBIDDEN');
    }
    const { address } = invitation.order;
    return {
      city: address.city,
      district: address.district,
      serviceZone: address.serviceZone,
      approximateDistanceKm: Math.round(distanceKm(
        Number(invitation.provider.latitude), Number(invitation.provider.longitude),
        Number(address.latitude), Number(address.longitude),
      ) * 10) / 10,
    };
  }

  public async getAssignedProviderView(orderId: string, providerUserId: string, now: Date) {
    const order = await this.prisma.order.findFirst({
      where: {
        id: orderId,
        assignedProvider: { userId: providerUserId },
        status: { in: ['PENDING_SERVICE', 'IN_SERVICE'] },
      },
      include: { address: true },
    });
    if (!order) {
      throw new Error('FORBIDDEN');
    }
    const opensAt = order.startsAt.getTime() - 60 * 60_000;
    const closesAt = order.startsAt.getTime() + (order.durationMinutes + 120) * 60_000;
    if (now.getTime() < opensAt || now.getTime() > closesAt) {
      throw new Error('FORBIDDEN');
    }
    const { address } = order;
    const detail = this.fieldCrypto.decrypt({
      ciphertext: Buffer.from(address.detailCiphertext),
      nonce: Buffer.from(address.detailNonce),
      authTag: Buffer.from(address.detailAuthTag),
      keyVersion: address.encryptionKeyVersion,
    });
    const accessInstructions = address.accessCiphertext && address.accessNonce && address.accessAuthTag
      ? this.fieldCrypto.decrypt({
        ciphertext: Buffer.from(address.accessCiphertext),
        nonce: Buffer.from(address.accessNonce),
        authTag: Buffer.from(address.accessAuthTag),
        keyVersion: address.encryptionKeyVersion,
      })
      : '';
    await this.audit.append({
      actorId: providerUserId,
      actorRole: 'PROVIDER',
      action: 'SENSITIVE_ADDRESS_VIEWED',
      entityType: 'ServiceAddress',
      entityId: address.id,
      metadata: { orderId },
    });
    return {
      city: address.city,
      district: address.district,
      serviceZone: address.serviceZone,
      detail,
      accessInstructions,
    };
  }
}
