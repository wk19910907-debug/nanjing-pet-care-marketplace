import { Prisma, type PrismaClient } from '@prisma/client';
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
  clientRequestId?: string | undefined;
};

export interface AddressLocationPolicy {
  assertSupported(location: CreateAddressInput): void;
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
    const normalized = {
      city: input.city.trim(), district: input.district.trim(), serviceZone: input.serviceZone.trim(),
      latitude: input.latitude, longitude: input.longitude, detail: input.detail.trim(),
      accessInstructions: input.accessInstructions,
    };
    this.locationPolicy?.assertSupported(normalized);
    const existing = input.clientRequestId
      ? await this.prisma.serviceAddress.findUnique({
        where: { ownerId_clientRequestId: { ownerId: actor.userId, clientRequestId: input.clientRequestId } },
      })
      : null;
    if (existing) return this.resolveExisting(existing, normalized);
    const detail = this.fieldCrypto.encrypt(normalized.detail);
    const access = normalized.accessInstructions
      ? this.fieldCrypto.encrypt(normalized.accessInstructions)
      : null;
    try {
      const address = await this.prisma.serviceAddress.create({ data: {
        ownerId: actor.userId,
        clientRequestId: input.clientRequestId ?? null,
        city: normalized.city,
        district: normalized.district,
        serviceZone: normalized.serviceZone,
        latitude: normalized.latitude,
        longitude: normalized.longitude,
        detailCiphertext: new Uint8Array(detail.ciphertext),
        detailNonce: new Uint8Array(detail.nonce),
        detailAuthTag: new Uint8Array(detail.authTag),
        accessCiphertext: access ? new Uint8Array(access.ciphertext) : null,
        accessNonce: access ? new Uint8Array(access.nonce) : null,
        accessAuthTag: access ? new Uint8Array(access.authTag) : null,
        encryptionKeyVersion: detail.keyVersion,
      }});
      return this.toOwnerView(address);
    } catch (error) {
      if (!input.clientRequestId || !this.isRequestIdCollision(error)) throw error;
      const raced = await this.prisma.serviceAddress.findUnique({
        where: { ownerId_clientRequestId: { ownerId: actor.userId, clientRequestId: input.clientRequestId } },
      });
      if (!raced) throw error;
      return this.resolveExisting(raced, normalized);
    }
  }

  public async list(actor: ActorContext) {
    authorizeRole(actor, ['OWNER']);
    const records = await this.prisma.serviceAddress.findMany({
      where: { ownerId: actor.userId },
      orderBy: { createdAt: 'asc' },
    });
    return records.map((record) => this.toOwnerView(record));
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

  private toOwnerView(address: {
    id: string; city: string; district: string; serviceZone: string;
    detailCiphertext: Uint8Array; detailNonce: Uint8Array; detailAuthTag: Uint8Array;
    encryptionKeyVersion: number;
  }) {
    return {
      id: address.id,
      city: address.city,
      district: address.district,
      serviceZone: address.serviceZone,
      detail: this.fieldCrypto.decrypt({
        ciphertext: Buffer.from(address.detailCiphertext),
        nonce: Buffer.from(address.detailNonce),
        authTag: Buffer.from(address.detailAuthTag),
        keyVersion: address.encryptionKeyVersion,
      }),
    };
  }

  private resolveExisting(address: {
    id: string; city: string; district: string; serviceZone: string;
    latitude: { toString(): string }; longitude: { toString(): string };
    detailCiphertext: Uint8Array; detailNonce: Uint8Array; detailAuthTag: Uint8Array;
    accessCiphertext: Uint8Array | null; accessNonce: Uint8Array | null; accessAuthTag: Uint8Array | null;
    encryptionKeyVersion: number;
  }, input: Omit<CreateAddressInput, 'clientRequestId'>) {
    const detail = this.toOwnerView(address).detail;
    const accessInstructions = address.accessCiphertext && address.accessNonce && address.accessAuthTag
      ? this.fieldCrypto.decrypt({
        ciphertext: Buffer.from(address.accessCiphertext), nonce: Buffer.from(address.accessNonce),
        authTag: Buffer.from(address.accessAuthTag), keyVersion: address.encryptionKeyVersion,
      })
      : '';
    if (
      address.city !== input.city
      || address.district !== input.district
      || address.serviceZone !== input.serviceZone
      || Number(address.latitude) !== input.latitude
      || Number(address.longitude) !== input.longitude
      || detail !== input.detail
      || accessInstructions !== input.accessInstructions
    ) {
      throw new Error('PROFILE_REQUEST_CONFLICT');
    }
    return this.toOwnerView(address);
  }

  private isRequestIdCollision(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}
