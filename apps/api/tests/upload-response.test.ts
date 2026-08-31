import { expect, it } from 'vitest';
import { toUploadResponse } from '../src/fulfillment/response-dtos.js';

it('preserves only the required S3 upload checksum header in the response DTO', () => {
  const record = { objectKey: 'orders/1/photo', uploadUrl: 'https://objects.example/photo',
    expiresInSeconds: 60, uploadHeaders: { 'x-amz-checksum-sha256': 'checksum', Authorization: 'must-not-cross' } };
  expect(toUploadResponse(record)).toEqual({ ...record, uploadHeaders: { 'x-amz-checksum-sha256': 'checksum' } });
});

it('keeps local uploads without extra headers backwards compatible', () => {
  const record = { objectKey: 'orders/1/photo', uploadUrl: '/local-evidence', expiresInSeconds: 60 };
  expect(toUploadResponse(record)).toEqual(record);
});
