-- CreateTable
CREATE TABLE "OwnerRecoveryCredential" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "lookupPrefix" CHAR(12) NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotatedAt" TIMESTAMPTZ(3),
    "lastUsedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "OwnerRecoveryCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffCredential" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "usernameNormalized" VARCHAR(64) NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ(3),
    "passwordChangedAt" TIMESTAMPTZ(3),
    "disabledAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "StaffCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderMessage" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "authorUserId" UUID NOT NULL,
    "authorRole" "ActorRole" NOT NULL,
    "bodyCiphertext" BYTEA NOT NULL,
    "bodyNonce" BYTEA NOT NULL,
    "bodyAuthTag" BYTEA NOT NULL,
    "encryptionKeyVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderMessage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "OrderMessage_authorRole_check" CHECK ("authorRole" IN ('OWNER', 'ADMIN'))
);

-- CreateIndex
CREATE UNIQUE INDEX "OwnerRecoveryCredential_userId_key" ON "OwnerRecoveryCredential"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "OwnerRecoveryCredential_tokenHash_key" ON "OwnerRecoveryCredential"("tokenHash");

-- CreateIndex
CREATE INDEX "OwnerRecoveryCredential_lookupPrefix_idx" ON "OwnerRecoveryCredential"("lookupPrefix");

-- CreateIndex
CREATE UNIQUE INDEX "StaffCredential_userId_key" ON "StaffCredential"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffCredential_usernameNormalized_key" ON "StaffCredential"("usernameNormalized");

-- CreateIndex
CREATE INDEX "OrderMessage_orderId_createdAt_id_idx" ON "OrderMessage"("orderId", "createdAt", "id");

-- AddForeignKey
ALTER TABLE "OwnerRecoveryCredential" ADD CONSTRAINT "OwnerRecoveryCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffCredential" ADD CONSTRAINT "StaffCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderMessage" ADD CONSTRAINT "OrderMessage_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderMessage" ADD CONSTRAINT "OrderMessage_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
