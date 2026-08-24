import type { PrismaClient } from '@prisma/client';
import type { ActorContext } from '../auth/auth-service.js';
import { authorizeRole } from '../auth/authorize.js';
import type { FieldCrypto } from '../adapters/field-crypto.js';

export type PetSpecies = 'CAT' | 'DOG';

export type CreatePetInput = {
  name: string;
  species: PetSpecies;
  sensitiveNotes: string;
};

export class PetService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly fieldCrypto: FieldCrypto,
  ) {}

  public async create(actor: ActorContext, input: CreatePetInput) {
    authorizeRole(actor, ['OWNER']);
    const notes = input.sensitiveNotes
      ? this.fieldCrypto.encryptPacked(input.sensitiveNotes)
      : null;
    const pet = await this.prisma.pet.create({ data: {
      ownerId: actor.userId,
      name: input.name.trim(),
      species: input.species === 'CAT' ? 'CAT_FEEDING' : 'DOG_WALKING',
      sensitiveNotes: notes ? new Uint8Array(notes.packed) : null,
      keyVersion: notes ? notes.keyVersion : null,
    }});
    return this.toOwnerView(pet);
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
}
