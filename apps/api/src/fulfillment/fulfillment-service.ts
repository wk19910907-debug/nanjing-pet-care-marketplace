import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { ObjectStorage } from '../adapters/object-storage.js';
import type { AuditRepository } from '../audit/audit-repository.js';
import type { ActorContext } from '../auth/auth-service.js';
import { authorizeRole } from '../auth/authorize.js';
import { validateChecklist } from './checklists.js';

type MediaInput = { mimeType: string; sizeBytes: number; sha256: string };
type ReportInput = {
  checklist: unknown;
  afterState: unknown;
  notes: string;
  checkedOutAt: Date;
};

const ALLOWED_MEDIA = new Set(['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime']);

export class FulfillmentService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: AuditRepository,
    private readonly storage: ObjectStorage,
    private readonly config: { maxUploadBytes: number; readUrlTtlSeconds: number },
  ) {}

  public async checkIn(actor: ActorContext, orderId: string, checkedInAt: Date, beforeState: unknown) {
    const assignment = await this.requireAssignedProvider(actor, orderId);
    if (assignment.order.status !== 'PENDING_SERVICE') throw new Error('FULFILLMENT_NOT_ALLOWED');
    if (!beforeState || typeof beforeState !== 'object' || Array.isArray(beforeState)) {
      throw new Error('VALIDATION_ERROR');
    }
    const earliest = new Date(assignment.order.startsAt.getTime() - 30 * 60_000);
    const latest = new Date(assignment.order.startsAt.getTime() + 2 * 60 * 60_000);
    if (checkedInAt < earliest || checkedInAt > latest) throw new Error('CHECK_IN_OUTSIDE_WINDOW');
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.order.updateMany({
        where: { id: orderId, status: 'PENDING_SERVICE', version: assignment.order.version },
        data: { status: 'IN_SERVICE', version: { increment: 1 } },
      });
      if (changed.count !== 1) throw new Error('FULFILLMENT_CONFLICT');
      const report = await tx.fulfillmentReport.create({ data: {
        orderId, providerId: assignment.profileId, checkedInAt,
        beforeState: beforeState as Prisma.InputJsonValue,
      }});
      await this.audit.append({
        actorId: actor.userId, actorRole: actor.role, action: 'SERVICE_CHECKED_IN',
        entityType: 'Order', entityId: orderId, metadata: { checkedInAt: checkedInAt.toISOString() },
      }, tx);
      return report;
    });
  }

  public async issueUpload(actor: ActorContext, orderId: string, input: MediaInput) {
    await this.requireAssignedProvider(actor, orderId);
    this.validateMedia(input);
    const objectKey = `orders/${orderId}/${randomUUID()}`;
    return this.storage.issueUpload({
      ...input,
      objectKey,
      expiresInSeconds: 600,
      quotaScope: { actorId: actor.userId, orderId },
    });
  }

  public async attachEvidence(
    actor: ActorContext,
    orderId: string,
    input: MediaInput & { objectKey: string; capturedAt: Date },
  ) {
    const assignment = await this.requireAssignedProvider(actor, orderId);
    this.validateMedia(input);
    if (!input.objectKey.startsWith(`orders/${orderId}/`)) throw new Error('FORBIDDEN');
    if (!await this.storage.verifyUpload(input.objectKey, input)) throw new Error('UPLOAD_NOT_VERIFIED');
    const report = await this.prisma.fulfillmentReport.findUnique({ where: { orderId } });
    if (!report || report.providerId !== assignment.profileId) throw new Error('CHECK_IN_REQUIRED');
    return this.prisma.$transaction(async (tx) => {
      const evidence = await tx.mediaEvidence.create({ data: {
        reportId: report.id, objectKey: input.objectKey, mimeType: input.mimeType,
        sizeBytes: input.sizeBytes, sha256: input.sha256, capturedAt: input.capturedAt,
      }});
      await this.audit.append({
        actorId: actor.userId, actorRole: actor.role, action: 'SERVICE_EVIDENCE_ATTACHED',
        entityType: 'Order', entityId: orderId, metadata: { evidenceId: evidence.id, mimeType: input.mimeType },
      }, tx);
      return evidence;
    });
  }

  public async submitReport(actor: ActorContext, orderId: string, input: ReportInput) {
    const assignment = await this.requireAssignedProvider(actor, orderId);
    if (assignment.order.status !== 'IN_SERVICE') throw new Error('FULFILLMENT_NOT_ALLOWED');
    if (input.notes.length > 1000) throw new Error('VALIDATION_ERROR');
    if (!input.afterState || typeof input.afterState !== 'object' || Array.isArray(input.afterState)) {
      throw new Error('AFTER_STATE_REQUIRED');
    }
    validateChecklist(assignment.order.serviceType, input.checklist);
    const report = await this.prisma.fulfillmentReport.findUnique({
      where: { orderId }, include: { media: true },
    });
    if (!report) throw new Error('CHECK_IN_REQUIRED');
    if (report.media.length === 0) throw new Error('EVIDENCE_REQUIRED');
    if (input.checkedOutAt <= report.checkedInAt) throw new Error('VALIDATION_ERROR');
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.order.updateMany({
        where: { id: orderId, status: 'IN_SERVICE', version: assignment.order.version },
        data: { status: 'PENDING_CONFIRMATION', version: { increment: 1 } },
      });
      if (changed.count !== 1) throw new Error('FULFILLMENT_CONFLICT');
      const saved = await tx.fulfillmentReport.update({
        where: { id: report.id }, data: {
          checklist: input.checklist as Prisma.InputJsonValue,
          afterState: input.afterState as Prisma.InputJsonValue,
          notes: input.notes, checkedOutAt: input.checkedOutAt, submittedAt: new Date(),
        },
      });
      await this.audit.append({
        actorId: actor.userId, actorRole: actor.role, action: 'SERVICE_REPORT_SUBMITTED',
        entityType: 'Order', entityId: orderId, metadata: { reportId: saved.id },
      }, tx);
      return saved;
    });
  }

  public async getEvidenceReadUrl(actor: ActorContext, evidenceId: string) {
    const evidence = await this.prisma.mediaEvidence.findUnique({
      where: { id: evidenceId }, include: { report: { include: { order: true, provider: true } } },
    });
    if (!evidence) throw new Error('EVIDENCE_NOT_FOUND');
    const canRead = (actor.role === 'OWNER' && evidence.report.order.ownerId === actor.userId)
      || (actor.role === 'PROVIDER' && evidence.report.provider.userId === actor.userId)
      || ['SUPPORT', 'ADMIN', 'DISPATCHER', 'REVIEWER'].includes(actor.role);
    if (!canRead) throw new Error('FORBIDDEN');
    const url = await this.storage.issueReadUrl(evidence.objectKey, this.config.readUrlTtlSeconds);
    await this.audit.append({
      actorId: actor.userId, actorRole: actor.role, action: 'SERVICE_EVIDENCE_READ',
      entityType: 'Order', entityId: evidence.report.orderId, metadata: { evidenceId },
    });
    return { url, expiresInSeconds: this.config.readUrlTtlSeconds };
  }

  private validateMedia(input: MediaInput): void {
    if (!ALLOWED_MEDIA.has(input.mimeType)) throw new Error('MEDIA_TYPE_NOT_ALLOWED');
    if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0) throw new Error('VALIDATION_ERROR');
    if (input.sizeBytes > this.config.maxUploadBytes) throw new Error('MEDIA_TOO_LARGE');
    if (!/^[a-f0-9]{64}$/i.test(input.sha256)) throw new Error('VALIDATION_ERROR');
  }

  private async requireAssignedProvider(actor: ActorContext, orderId: string) {
    authorizeRole(actor, ['PROVIDER']);
    const profile = await this.prisma.providerProfile.findUnique({ where: { userId: actor.userId } });
    if (!profile) throw new Error('FORBIDDEN');
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.assignedProviderId !== profile.id) throw new Error('FORBIDDEN');
    return { profileId: profile.id, order };
  }
}
