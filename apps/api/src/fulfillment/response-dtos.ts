type Timestamp = Date | string;

function timestamp(value: Timestamp | null | undefined): string {
  const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) throw new Error('FULFILLMENT_CONFLICT');
  return date.toISOString();
}

export function toCheckInResponse(record: {
  id: string; orderId: string; checkedInAt: Timestamp;
}) {
  return { id: record.id, orderId: record.orderId, checkedInAt: timestamp(record.checkedInAt) };
}

export function toEvidenceResponse(record: { id: string }) {
  return { id: record.id };
}

export function toReportResponse(record: {
  id: string; orderId: string; submittedAt: Timestamp | null;
}) {
  return { id: record.id, orderId: record.orderId, submittedAt: timestamp(record.submittedAt) };
}

export function toUploadResponse(record: {
  objectKey: string; uploadUrl: string; expiresInSeconds: number;
}) {
  return {
    objectKey: record.objectKey,
    uploadUrl: record.uploadUrl,
    expiresInSeconds: record.expiresInSeconds,
  };
}
