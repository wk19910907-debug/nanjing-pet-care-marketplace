import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationUrl = new URL('../../../prisma/migrations/202608230001_initial/migration.sql', import.meta.url);

describe('initial database migration', () => {
  it('defines every marketplace table', async () => {
    const sql = await readFile(fileURLToPath(migrationUrl), 'utf8');
    for (const table of [
      'User', 'ProviderProfile', 'Pet', 'ServiceAddress', 'Order', 'OrderPet',
      'DispatchInvitation', 'FulfillmentReport', 'MediaEvidence', 'Payment',
      'Refund', 'Settlement', 'Dispute', 'AuditEvent',
    ]) {
      expect(sql).toContain(`CREATE TABLE "${table}"`);
    }
  });

  it('protects idempotency and concurrent assignment', async () => {
    const sql = await readFile(fileURLToPath(migrationUrl), 'utf8');
    expect(sql).toContain('CREATE UNIQUE INDEX "Payment_providerEventId_key"');
    expect(sql).toContain('CREATE UNIQUE INDEX "Order_idempotencyKey_ownerId_key"');
    expect(sql).toContain('CREATE UNIQUE INDEX "Order_active_provider_assignment"');
    expect(sql).toContain('"version" INTEGER NOT NULL DEFAULT 0');
  });

  it('stores encrypted address fields and append-only audit data', async () => {
    const sql = await readFile(fileURLToPath(migrationUrl), 'utf8');
    expect(sql).toContain('"detailCiphertext" BYTEA NOT NULL');
    expect(sql).toContain('"accessCiphertext" BYTEA');
    expect(sql).toContain('"encryptionKeyVersion" INTEGER NOT NULL');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION prevent_audit_mutation()');
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON "AuditEvent"');
  });
});
