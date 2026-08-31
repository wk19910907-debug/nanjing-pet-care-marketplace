-- Nullable request identifiers preserve the legacy create behavior while allowing
-- owner-scoped idempotency when a client supplies one.
ALTER TABLE "Pet" ADD COLUMN "clientRequestId" VARCHAR(100);
ALTER TABLE "ServiceAddress" ADD COLUMN "clientRequestId" VARCHAR(100);

CREATE UNIQUE INDEX "Pet_ownerId_clientRequestId_key"
  ON "Pet"("ownerId", "clientRequestId");
CREATE UNIQUE INDEX "ServiceAddress_ownerId_clientRequestId_key"
  ON "ServiceAddress"("ownerId", "clientRequestId");
