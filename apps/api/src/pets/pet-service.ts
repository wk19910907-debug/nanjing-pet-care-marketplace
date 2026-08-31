import { Prisma, type PrismaClient } from '@prisma/client';
import type { ActorContext } from '../auth/auth-service.js';
import { authorizeRole } from '../auth/authorize.js';
import type { FieldCrypto } from '../adapters/field-crypto.js';

export type PetSpecies = 'CAT' | 'DOG';

export type CreatePetInput = {
  name: string;
  species: PetSpecies;
  sensitiveNotes: string;
  clientRequestId?: string | undefined;
};

export class PetService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly fieldCrypto: FieldCrypto,
  ) {}

  public async create(actor: ActorContext, input: CreatePetInput) {
    authorizeRole(actor, ['OWNER']);
    const normalized = {
      name: input.name.trim(),
      species: input.species,
      sensitiveNotes: input.sensitiveNotes,
    };
    const existing = input.clientRequestId
      ? await this.prisma.pet.findUnique({
        where: { ownerId_clientRequestId: { ownerId: actor.userId, clientRequestId: input.clientRequestId } },
      })
      : null;
    if (existing) {
      return this.resolveExisting(existing, normalized);
    }
    const notes = normalized.sensitiveNotes
      ? this.fieldCrypto.encryptPacked(normalized.sensitiveNotes)
      : null;
    try {
      const pet = await this.prisma.pet.create({ data: {
        ownerId: actor.userId,
        clientRequestId: input.clientRequestId ?? null,
        name: normalized.name,
        species: normalized.species === 'CAT' ? 'CAT_FEEDING' : 'DOG_WALKING',
        sensitiveNotes: notes ? new Uint8Array(notes.packed) : null,
        keyVersion: notes ? notes.keyVersion : null,
      }});
      return this.toOwnerView(pet);
    } catch (error) {
      if (!input.clientRequestId || !this.isRequestIdCollision(error)) throw error;
      const raced = await this.prisma.pet.findUnique({
        where: { ownerId_clientRequestId: { ownerId: actor.userId, clientRequestId: input.clientRequestId } },
      });
      if (!raced) throw error;
      return this.resolveExisting(raced, normalized);
    }
  }

  public async list(actor: ActorContext) {
    authorizeRole(actor, ['OWNER']);
    const records = await this.prisma.pet.findMany({
      where: { ownerId: actor.userId }, orderBy: { createdAt: 'asc' },
    });
    return records.map((record) => this.toOwnerView(record));
  }

  public async rename(actor: ActorContext, petId: string, name: string) {
    authorizeRole(actor, ['OWNER']);
    const updated = await this.prisma.pet.updateMany({
      where: { id: petId, ownerId: actor.userId }, data: { name: name.trim() },
    });
    if (updated.count !== 1) {
      throw new Error('FORBIDDEN');
    }
    return this.prisma.pet.findUniqueOrThrow({ where: { id: petId } });
  }

  private toOwnerView(pet: {
    id: string; name: string; species: 'CAT_FEEDING' | 'DOG_WALKING';
    sensitiveNotes: Uint8Array | null; keyVersion: number | null;
  }) {
    return {
      id: pet.id,
      name: pet.name,
      species: pet.species === 'CAT_FEEDING' ? 'CAT' as const : 'DOG' as const,
      sensitiveNotes: pet.sensitiveNotes && pet.keyVersion !== null
        ? this.fieldCrypto.decryptPacked(pet.sensitiveNotes, pet.keyVersion)
        : '',
    };
  }

  private resolveExisting(pet: {
    id: string; name: string; species: 'CAT_FEEDING' | 'DOG_WALKING';
    sensitiveNotes: Uint8Array | null; keyVersion: number | null;
  }, input: Omit<CreatePetInput, 'clientRequestId'>) {
    const existing = this.toOwnerView(pet);
    if (
      existing.name !== input.name
      || existing.species !== input.species
      || existing.sensitiveNotes !== input.sensitiveNotes
    ) {
      throw new Error('PROFILE_REQUEST_CONFLICT');
    }
    return existing;
  }

  private isRequestIdCollision(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}
