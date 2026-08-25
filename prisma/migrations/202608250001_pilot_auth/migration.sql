-- AlterTable
ALTER TABLE "User" ADD COLUMN "displayName" VARCHAR(30);

-- CreateTable
CREATE TABLE "PilotInvite" (
    "id" UUID NOT NULL,
    "codeHash" CHAR(64) NOT NULL,
    "role" "ActorRole" NOT NULL,
    "targetUserId" UUID,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "consumedAt" TIMESTAMPTZ(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PilotInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PilotSession" (
    "id" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "userId" UUID NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PilotSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PilotInvite_codeHash_key" ON "PilotInvite"("codeHash");

-- CreateIndex
CREATE INDEX "PilotInvite_expiresAt_consumedAt_idx" ON "PilotInvite"("expiresAt", "consumedAt");

-- CreateIndex
CREATE INDEX "PilotInvite_createdById_createdAt_idx" ON "PilotInvite"("createdById", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PilotSession_tokenHash_key" ON "PilotSession"("tokenHash");

-- CreateIndex
CREATE INDEX "PilotSession_userId_expiresAt_idx" ON "PilotSession"("userId", "expiresAt");

-- AddForeignKey
ALTER TABLE "PilotInvite" ADD CONSTRAINT "PilotInvite_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PilotInvite" ADD CONSTRAINT "PilotInvite_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PilotSession" ADD CONSTRAINT "PilotSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
